from __future__ import annotations

import json
import subprocess

from mcp.server.fastmcp import FastMCP
from mcp.types import Annotations, ToolAnnotations

from apple_maps_mcp.config import load_settings
from apple_maps_mcp.maps_bridge import AppleMapsBridge, MapsBridgeError, build_bridge
from apple_maps_mcp.models import (
    CampusHopResponse,
    DirectionsResponse,
    ErrorResponse,
    HealthResponse,
    HopFeasibility,
    MapsLinkResponse,
    OpenMapsResponse,
    PlaceRecord,
    PlaceSearchResponse,
    ToolError,
    TravelMatrixResponse,
    TravelOption,
)

SERVER_INSTRUCTIONS = (
    "Use this server for Apple Maps and travel context on macOS. "
    "Search here when the user wants to find a place, estimate travel time, build an Apple Maps link, or open directions in Apple Maps."
)

mcp = FastMCP("Apple Maps MCP", instructions=SERVER_INSTRUCTIONS, json_response=True)


def _bridge() -> AppleMapsBridge:
    return build_bridge()


def _error_response(error_code: str, message: str, suggestion: str | None = None) -> ErrorResponse:
    return ErrorResponse(error=ToolError(error_code=error_code, message=message, suggestion=suggestion))


def _resource_json(value: object) -> str:
    return json.dumps(value, indent=2, sort_keys=True, default=str)


@mcp.resource(
    "maps://status",
    name="maps_status",
    title="Maps Status",
    description="Apple Maps helper availability and supported transport modes.",
    mime_type="application/json",
    annotations=Annotations(audience=["assistant"], priority=0.75),
)
def maps_status_resource() -> str:
    helper_available, helper_compiled = _bridge().helper_available()
    return _resource_json(
        {
            "helper_available": helper_available,
            "helper_compiled": helper_compiled,
            "supported_transports": ["driving", "walking", "transit"],
        }
    )


@mcp.prompt(name="maps_plan_route", title="Plan Route")
def maps_plan_route_prompt() -> str:
    return (
        "Use Apple Maps to find the right destination, estimate travel time, and choose the right transport mode "
        "before scheduling a meeting or sending directions."
    )


@mcp.tool(
    title="Maps Health",
    description="Report the active Apple Maps MCP configuration.",
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    structured_output=True,
)
def maps_health() -> HealthResponse:
    settings = load_settings()
    helper_available, helper_compiled = _bridge().helper_available()
    return HealthResponse(
        server_name=settings.server_name,
        version=settings.version,
        helper_available=helper_available,
        helper_compiled=helper_compiled,
        transport=settings.transport,
        capabilities=[
            "search_places",
            "get_directions",
            "build_maps_link",
            "open_directions_in_maps",
            "resources",
            "prompts",
        ],
        supports=["stdio", "streamable-http"],
    )


@mcp.tool(
    title="Maps Permission Guide",
    description="Explain Apple Maps MCP local helper requirements on macOS.",
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    structured_output=True,
)
def maps_permission_guide() -> dict[str, object]:
    return {
        "ok": True,
        "domain": "maps",
        "can_prompt_in_app": False,
        "requires_manual_system_settings": False,
        "steps": [
            "Apple Maps MCP uses a local Swift helper for search and routing.",
            "If helper compilation fails, install Xcode command line tools and retry.",
            "Opening a route uses the standard macOS open command with an Apple Maps URL.",
        ],
    }


@mcp.tool(
    title="Search Places",
    description="Search Apple Maps for matching places.",
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    structured_output=True,
)
def maps_search_places(query: str, limit: int = 5) -> PlaceSearchResponse | ErrorResponse:
    try:
        payload = _bridge().search_places(query=query, limit=limit)
        places = [PlaceRecord(**item) for item in payload.get("places", [])]
        return PlaceSearchResponse(places=places, count=len(places))
    except MapsBridgeError as exc:
        return _error_response(exc.error_code, exc.message, exc.suggestion)


@mcp.tool(
    title="Get Directions",
    description="Get Apple Maps route details between an origin and destination.",
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    structured_output=True,
)
def maps_get_directions(origin: str, destination: str, transport: str = "driving") -> DirectionsResponse | ErrorResponse:
    try:
        payload = _bridge().directions(origin=origin, destination=destination, transport=transport)
        return DirectionsResponse(
            origin=PlaceRecord(**payload["origin"]),
            destination=PlaceRecord(**payload["destination"]),
            transport=str(payload["transport"]),
            distance_meters=float(payload["distance_meters"]),
            expected_travel_time_seconds=float(payload["expected_travel_time_seconds"]),
            advisory_notices=[str(item) for item in payload.get("advisory_notices", [])],
            maps_url=str(payload["maps_url"]),
        )
    except MapsBridgeError as exc:
        return _error_response(exc.error_code, exc.message, exc.suggestion)


def _route_leg(origin: str, destination: str, transport: str) -> TravelOption:
    """Prices a single origin→destination leg, returning a failed option rather than
    raising so one bad address cannot sink a whole comparison."""
    try:
        payload = _bridge().directions(origin=origin, destination=destination, transport=transport)
        seconds = float(payload["expected_travel_time_seconds"])
        return TravelOption(
            destination_query=destination,
            transport=str(payload["transport"]),
            ok=True,
            destination=PlaceRecord(**payload["destination"]),
            distance_meters=float(payload["distance_meters"]),
            expected_travel_time_seconds=seconds,
            expected_travel_time_minutes=round(seconds / 60, 1),
            advisory_notices=[str(item) for item in payload.get("advisory_notices", [])],
            maps_url=str(payload["maps_url"]),
        )
    except MapsBridgeError as exc:
        return TravelOption(
            destination_query=destination,
            transport=transport,
            ok=False,
            error=ToolError(
                error_code=exc.error_code, message=exc.message, suggestion=exc.suggestion
            ),
        )


@mcp.tool(
    title="Compare Travel Times",
    description=(
        "Compare travel time from one origin to several destinations and/or by several "
        "transport modes in a single call, and get back the fastest option plus a ready-made "
        "calendar alarm offset. Use it to answer 'which of these is closest?', 'should I walk "
        "or drive?', and 'when do I need to leave?'. A leg that cannot be routed is reported "
        "as a failed option instead of failing the whole call. The leave_by_offset_seconds "
        "value is negative and already includes buffer_minutes, so it can be passed straight "
        "to a calendar/reminder alarm relativeOffset to get a 'time to leave' alert."
    ),
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    structured_output=True,
)
def maps_compare_travel_times(
    origin: str,
    destinations: list[str],
    transports: list[str] | None = None,
    buffer_minutes: int = 0,
) -> TravelMatrixResponse | ErrorResponse:
    if not destinations:
        return _error_response(
            "NO_DESTINATIONS",
            "Provide at least one destination.",
            "Pass destinations as a list of place names or addresses.",
        )
    if len(destinations) > 10:
        return _error_response(
            "TOO_MANY_DESTINATIONS",
            "At most 10 destinations can be compared in one call.",
            "Split the list across multiple calls.",
        )
    modes = transports or ["driving"]
    if len(modes) > 4:
        return _error_response(
            "TOO_MANY_TRANSPORTS",
            "At most 4 transport modes can be compared in one call.",
            "Typical modes are driving, walking, and transit.",
        )
    if buffer_minutes < 0 or buffer_minutes > 240:
        return _error_response(
            "INVALID_BUFFER",
            "buffer_minutes must be between 0 and 240.",
            "Use a small buffer such as 10 to allow for getting out the door.",
        )

    options = [
        _route_leg(origin, destination, transport)
        for destination in destinations
        for transport in modes
    ]
    succeeded = [option for option in options if option.ok]
    fastest = min(
        succeeded,
        key=lambda option: option.expected_travel_time_seconds or float("inf"),
        default=None,
    )
    leave_by = None
    if fastest and fastest.expected_travel_time_seconds is not None:
        leave_by = -int(fastest.expected_travel_time_seconds + buffer_minutes * 60)

    return TravelMatrixResponse(
        origin_query=origin,
        options=options,
        count=len(options),
        succeeded=len(succeeded),
        failed=len(options) - len(succeeded),
        fastest=fastest,
        leave_by_offset_seconds=leave_by,
    )


@mcp.tool(
    title="Check Back-To-Back Hops",
    description=(
        "Check whether a sequence of back-to-back commitments is physically makeable: for "
        "each hop it compares the gap between one ending and the next starting against the "
        "actual travel time, and reports the slack left over. Built for back-to-back classes "
        "in different buildings, but works for any tight schedule. Pass each hop with the "
        "locations and the minutes available between them (end of one, start of the next). "
        "Anything with negative slack is flagged as not feasible, so you can move the event, "
        "switch transport mode, or set an earlier leave-by alarm."
    ),
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    structured_output=True,
)
def maps_check_campus_hops(
    hops: list[dict], default_transport: str = "walking", buffer_minutes: int = 5
) -> CampusHopResponse | ErrorResponse:
    if not hops:
        return _error_response(
            "NO_HOPS",
            "Provide at least one hop.",
            'Each hop needs from_location, to_location, and available_minutes.',
        )
    if len(hops) > 12:
        return _error_response(
            "TOO_MANY_HOPS",
            "At most 12 hops can be checked in one call.",
            "Split a full week across multiple calls.",
        )
    if buffer_minutes < 0 or buffer_minutes > 120:
        return _error_response(
            "INVALID_BUFFER",
            "buffer_minutes must be between 0 and 120.",
            "5 minutes is a reasonable default for packing up and walking out.",
        )

    results: list[HopFeasibility] = []
    for index, hop in enumerate(hops):
        origin = str(hop.get("from_location") or "").strip()
        destination = str(hop.get("to_location") or "").strip()
        transport = str(hop.get("transport") or default_transport)
        raw_available = hop.get("available_minutes")

        if not origin or not destination:
            results.append(
                HopFeasibility(
                    from_location=origin or f"hop {index + 1}",
                    to_location=destination or f"hop {index + 1}",
                    transport=transport,
                    ok=False,
                    verdict="skipped: from_location and to_location are both required",
                    error=ToolError(
                        error_code="MISSING_LOCATION",
                        message="from_location and to_location are required.",
                        suggestion="Provide both building names or addresses.",
                    ),
                )
            )
            continue

        try:
            available = float(raw_available)
        except (TypeError, ValueError):
            results.append(
                HopFeasibility(
                    from_location=origin,
                    to_location=destination,
                    transport=transport,
                    ok=False,
                    verdict="skipped: available_minutes must be a number",
                    error=ToolError(
                        error_code="INVALID_AVAILABLE_MINUTES",
                        message="available_minutes must be a number.",
                        suggestion="Use the gap in minutes between one ending and the next starting.",
                    ),
                )
            )
            continue

        leg = _route_leg(origin, destination, transport)
        if not leg.ok or leg.expected_travel_time_seconds is None:
            results.append(
                HopFeasibility(
                    from_location=origin,
                    to_location=destination,
                    transport=transport,
                    ok=False,
                    available_minutes=available,
                    verdict="could not route this hop",
                    error=leg.error,
                )
            )
            continue

        travel = round(leg.expected_travel_time_seconds / 60, 1)
        slack = round(available - travel - buffer_minutes, 1)
        feasible = slack >= 0
        if feasible:
            verdict = f"OK — {slack} min to spare (after a {buffer_minutes} min buffer)"
        else:
            verdict = (
                f"TIGHT — short by {abs(slack)} min; travel is {travel} min but only "
                f"{available} min available. Try a faster mode, a nearer room, or shifting a time."
            )

        results.append(
            HopFeasibility(
                from_location=origin,
                to_location=destination,
                transport=transport,
                ok=True,
                available_minutes=available,
                travel_minutes=travel,
                slack_minutes=slack,
                feasible=feasible,
                verdict=verdict,
                maps_url=leg.maps_url,
            )
        )

    scored = [hop for hop in results if hop.slack_minutes is not None]
    return CampusHopResponse(
        hops=results,
        count=len(results),
        infeasible_count=sum(1 for hop in results if hop.feasible is False),
        tightest=min(scored, key=lambda hop: hop.slack_minutes, default=None),
    )


@mcp.tool(
    title="Build Maps Link",
    description="Build an Apple Maps URL for a destination or route.",
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    structured_output=True,
)
def maps_build_maps_link(destination: str, origin: str | None = None, transport: str = "driving") -> MapsLinkResponse:
    return MapsLinkResponse(url=_bridge().maps_url(destination=destination, origin=origin, transport=transport))


@mcp.tool(
    title="Open Directions In Maps",
    description="Open directions in the Apple Maps app.",
    annotations=ToolAnnotations(destructiveHint=False, idempotentHint=False, openWorldHint=True),
    structured_output=True,
)
def maps_open_directions_in_maps(destination: str, origin: str | None = None, transport: str = "driving") -> OpenMapsResponse | ErrorResponse:
    try:
        url = _bridge().maps_url(destination=destination, origin=origin, transport=transport)
        subprocess.run(["open", url], capture_output=True, check=True, text=True)
        return OpenMapsResponse(opened=True, url=url)
    except (MapsBridgeError, subprocess.CalledProcessError) as exc:
        if isinstance(exc, MapsBridgeError):
            return _error_response(exc.error_code, exc.message, exc.suggestion)
        return _error_response("OPEN_FAILED", "Failed to open Apple Maps.", "Retry the request.")


def _serialize_prompt_messages(messages: list[object]) -> list[dict[str, object]]:
    return [
        {
            "role": getattr(message, "role", "user"),
            "content": message.content.model_dump(mode="json") if hasattr(message.content, "model_dump") else message.content,
        }
        for message in messages
    ]


@mcp.tool(
    title="Maps List Prompts",
    description="Fallback prompt discovery tool for tool-only MCP clients.",
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    structured_output=True,
)
async def maps_list_prompts() -> dict[str, object]:
    prompts = await mcp.list_prompts()
    return {
        "ok": True,
        "prompts": [{"name": prompt.name, "title": prompt.title, "description": prompt.description} for prompt in prompts],
        "count": len(prompts),
    }


@mcp.tool(
    title="Maps Get Prompt",
    description="Fallback prompt rendering tool for tool-only MCP clients.",
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
    structured_output=True,
)
async def maps_get_prompt_prompt(name: str, arguments_json: str | None = None) -> dict[str, object]:
    arguments = json.loads(arguments_json) if arguments_json else None
    prompt = await mcp.get_prompt(name, arguments)
    return {"ok": True, "name": name, "messages": _serialize_prompt_messages(prompt.messages), "message_count": len(prompt.messages)}


@mcp._mcp_server.subscribe_resource()
async def _maps_subscribe_resource(uri) -> None:
    del uri


@mcp._mcp_server.unsubscribe_resource()
async def _maps_unsubscribe_resource(uri) -> None:
    del uri


def main() -> None:
    settings = load_settings()
    if settings.transport == "stdio":
        mcp.run(transport="stdio")
        return
    mcp.settings.host = settings.host
    mcp.settings.port = settings.port
    mcp.settings.log_level = settings.log_level
    mcp.settings.stateless_http = True
    mcp.settings.json_response = True
    mcp.run(transport="streamable-http")
