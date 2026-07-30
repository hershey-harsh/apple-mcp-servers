from __future__ import annotations

from pydantic import BaseModel, Field


class ToolError(BaseModel):
    error_code: str = Field(description="Stable machine-readable error code")
    message: str = Field(description="Human-readable error message")
    suggestion: str | None = Field(default=None, description="Suggested next step")


class ErrorResponse(BaseModel):
    ok: bool = False
    error: ToolError


class HealthResponse(BaseModel):
    ok: bool = True
    server_name: str
    version: str
    helper_available: bool
    helper_compiled: bool
    transport: str
    capabilities: list[str]
    supports: list[str]


class PlaceRecord(BaseModel):
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    phone: str | None = None
    url: str | None = None


class PlaceSearchResponse(BaseModel):
    ok: bool = True
    places: list[PlaceRecord]
    count: int


class DirectionsResponse(BaseModel):
    ok: bool = True
    origin: PlaceRecord
    destination: PlaceRecord
    transport: str
    distance_meters: float
    expected_travel_time_seconds: float
    advisory_notices: list[str]
    maps_url: str


class TravelOption(BaseModel):
    """One origin/destination/transport combination that was priced."""

    destination_query: str = Field(description="The destination string that was requested")
    transport: str
    ok: bool = Field(description="False when this leg could not be routed")
    destination: PlaceRecord | None = None
    distance_meters: float | None = None
    expected_travel_time_seconds: float | None = None
    expected_travel_time_minutes: float | None = None
    advisory_notices: list[str] = Field(default_factory=list)
    maps_url: str | None = None
    error: ToolError | None = Field(
        default=None, description="Why this leg failed, when ok is false"
    )


class TravelMatrixResponse(BaseModel):
    ok: bool = True
    origin_query: str
    options: list[TravelOption]
    count: int
    succeeded: int
    failed: int
    fastest: TravelOption | None = Field(
        default=None, description="The quickest option that routed successfully"
    )
    leave_by_offset_seconds: int | None = Field(
        default=None,
        description=(
            "Negative seconds to use as a calendar alarm relativeOffset for the fastest "
            "option, including any requested buffer"
        ),
    )


class HopFeasibility(BaseModel):
    """Whether one back-to-back transition can actually be made on time."""

    from_location: str
    to_location: str
    transport: str
    ok: bool
    available_minutes: float | None = None
    travel_minutes: float | None = None
    slack_minutes: float | None = Field(
        default=None, description="available_minutes - travel_minutes - buffer"
    )
    feasible: bool | None = None
    verdict: str
    maps_url: str | None = None
    error: ToolError | None = None


class CampusHopResponse(BaseModel):
    ok: bool = True
    hops: list[HopFeasibility]
    count: int
    infeasible_count: int
    tightest: HopFeasibility | None = None


class MapsLinkResponse(BaseModel):
    ok: bool = True
    url: str


class OpenMapsResponse(BaseModel):
    ok: bool = True
    opened: bool
    url: str
