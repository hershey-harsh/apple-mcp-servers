# Apple Maps MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for **Apple Maps** search and routing on macOS. Useful on its own and as the travel‑time source for the Reminders/Calendar server.

Part of the [Apple MCP Servers](../README.md) collection.

## Capabilities

- **Search places** — `maps_search_places`.
- **Directions & travel time** — `maps_get_directions(origin, destination, transport)` returns `expected_travel_time_seconds`, distance, and an Apple Maps URL.
- **Apple Maps links** — build and open directions in Apple Maps.
- **Health & permissions** — `maps_health`, `maps_permission_guide`.
- **Prompt** — `maps_plan_route`.

Tools are exposed directly in `tools/list` (no search‑first indirection).

## Coordination

Use this server whenever travel, routing, or place lookup affects a Calendar, Reminders, Messages, or Mail action. For example, feed `expected_travel_time_seconds` into a reminder/event alarm offset so it fires when the user needs to leave — see [`apple-events`](../apple-events/) for a worked example.

## Requirements

- macOS. The native Maps helper is compiled on first use with `swiftc`; if compilation fails, install the Xcode command line tools (`xcode-select --install`) and retry.

## Running

```bash
bash start.sh
```

`start.sh` uses [uv](https://docs.astral.sh/uv/) to provision Python and dependencies, then launches the server over stdio.

## License

[MIT](LICENSE) © 2026 Harsh
