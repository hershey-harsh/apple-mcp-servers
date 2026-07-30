# Apple Events MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for **Apple Reminders and Calendar** on macOS. It talks to EventKit through a small native Swift helper (`bin/EventKitCLI`), so reminders, lists, events, and calendars are created and edited exactly as the built‑in apps would.

Part of the [Apple MCP Servers](../README.md) collection.

## Tools

| Tool | Actions | Notes |
| --- | --- | --- |
| `reminders_tasks` | read, create, update, delete | Title, notes, URL, location, priority, start/due dates, alarms (display/audio/procedure/email, absolute/relative/location‑trigger), recurrence |
| `reminders_lists` | read, create, update, delete | Including **list color** (hex) |
| `reminders_subtasks` | read, create, update, delete, toggle, reorder | Checklist items within a reminder |
| `calendar_events` | read, create, update, delete | Location, structured location (geo), URL, all‑day, availability, alarms, recurrence, per‑event time zone, `this-event`/`future-events` span |
| `calendar_calendars` | read, create, update, delete | Create/rename/recolor and delete calendars — **including calendar color** (hex) |

## Travel‑time reminders (coordination with Apple Maps)

Reminders and events accept alarms with a `relativeOffset` in seconds. To be reminded *when you need to leave* rather than when the event starts, get the trip duration from the [`apple-maps`](../apple-maps/) server and set the offset to the negative of that duration.

Example — a class in *Building A* starting at 10:00, leaving from *Building B*:

1. `apple-maps` → `maps_get_directions(origin: "Building B", destination: "Building A", transport: "walking")` returns `expected_travel_time_seconds` (say 600 = 10 minutes).
2. `calendar_events` → `create` the 10:00 event with `location: "Building A"` and an alarm `{ relativeOffset: -600 }`.

The alarm now fires at 09:50 — "time to leave Building B for Building A." Add a buffer (e.g. `-(600 + 120)`) to leave a couple of minutes early.

## Requirements

- macOS with the Swift toolchain (`swiftc`) available — the native helper is compiled automatically on first launch and whenever its source changes.
- Reminders and Calendar permissions, which macOS prompts for the first time the server runs under your MCP host.

## Running

```bash
bash start.sh
```

`start.sh` compiles `bin/EventKitCLI` from `src/swift/EventKitCLI.swift` when needed and runs the TypeScript server live via `tsx`, so edits under `src/` take effect on the next launch.

## Platform limits (honest notes)

EventKit is the public, supported API — a few things a person can do in the apps are simply not exposed by it, and this server does not fake them:

- **Reminder list icon / emoji (e.g. the pin glyph)** — not settable via EventKit. Only the list *color* is.
- **Calendar event priority** — `EKEvent` has no priority field (only reminders do).
- **Adding invitees/attendees to an event** — read‑only in EventKit.

## License

[MIT](LICENSE) © 2026 Harsh
