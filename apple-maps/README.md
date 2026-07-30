# Apple Maps MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for **Apple Maps** search and routing on macOS. Useful on its own and as the travel‑time source for the Reminders/Calendar server.

Part of the [Apple MCP Servers](../README.md) collection.

## Capabilities

- **Search places** — `maps_search_places`.
- **Directions & travel time** — `maps_get_directions(origin, destination, transport)` returns `expected_travel_time_seconds`, distance, and an Apple Maps URL.
- **Compare options** — `maps_compare_travel_times(origin, destinations, transports, buffer_minutes)` prices several destinations and/or modes in one call, picks the fastest, and returns a `leave_by_offset_seconds` (already negative, buffer included) ready to drop into a calendar alarm's `relativeOffset`. A leg that cannot be routed is reported as a failed option rather than failing the whole call.
- **Back‑to‑back feasibility** — `maps_check_campus_hops(hops, default_transport, buffer_minutes)` takes a sequence of transitions with the minutes available between them and reports the slack left after travel, flagging any hop that cannot physically be made.
- **Apple Maps links** — build and open directions in Apple Maps.
- **Health & permissions** — `maps_health`, `maps_permission_guide`.
- **Prompt** — `maps_plan_route`.

Tools are exposed directly in `tools/list` (no search‑first indirection).

## Coordination

Use this server whenever travel, routing, or place lookup affects a Calendar, Reminders, Messages, or Mail action. For example, feed `expected_travel_time_seconds` into a reminder/event alarm offset so it fires when the user needs to leave — see [`apple-events`](../apple-events/) for a worked example.

`maps_check_campus_hops` pairs directly with a day's agenda: read consecutive events from [`apple-events`](../apple-events/) `calendar_schedule` `agenda`, pass each transition with the real gap between them, and anything with negative slack is a schedule problem to fix before the day starts. `maps_search_places` supplies the latitude/longitude for geofence alarms and event `structuredLocation`.

## Requirements

- macOS. The native Maps helper is compiled on first use with `swiftc`; if compilation fails, install the Xcode command line tools (`xcode-select --install`) and retry.

## Running

```bash
bash start.sh
```

`start.sh` uses [uv](https://docs.astral.sh/uv/) to provision Python and dependencies, then launches the server over stdio.

## License

[MIT](LICENSE) © 2026 Harsh
