# Apple Events MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for **Apple Reminders and Calendar** on macOS. It talks to EventKit through a small native Swift helper (`bin/EventKitCLI`), so reminders, lists, events, and calendars are created and edited exactly as the built‑in apps would.

Part of the [Apple MCP Servers](../README.md) collection.

## Tools

| Tool | Actions | Notes |
| --- | --- | --- |
| `reminders_tasks` | read, create, update, delete | Title, notes, URL, location, priority, start/due dates, alarms (absolute / relative / geofence trigger, with an optional **sound or email** action), recurrence |
| `reminders_lists` | read, create, update, delete | Including **list color** (hex) |
| `reminders_subtasks` | read, create, update, delete, toggle, reorder | Checklist items within a reminder |
| `calendar_events` | read, create, update, delete | Location, structured location (geo), URL, all‑day, availability, alarms (with an optional **sound or email** action), recurrence, per‑event time zone, `this-event`/`future-events` span |
| `calendar_calendars` | read, create, update, delete | Create/rename/recolor and delete calendars — **including calendar color** (hex) |
| `calendar_schedule` | agenda, free-slots, conflicts | Read‑only planning: merged events + reminders timeline with overlap warnings, open‑slot finder (daily window, weekday filter, buffer), and clash checks for proposed times |
| `calendar_batch` | create-events, delete-events, cancel-occurrences, create-class-schedule, schedule-study-blocks | Multi‑event writes with per‑item results; whole‑term class schedules with break weeks removed; study blocks placed into genuinely free time |
| `reminders_batch` | create, update, complete, delete | Multi‑reminder writes with per‑item results; complete/delete accept plain **titles** as well as IDs |

### Dates in plain language

Every date parameter accepts `YYYY-MM-DD`, `YYYY-MM-DD HH:mm:ss`, ISO 8601 — **or** ordinary phrasing, resolved server‑side:

`today` · `tomorrow 3pm` · `tonight` · `next monday` · `this friday` · `last tuesday` · `friday at 17:00` · `in 2 hours` · `in 3 days` · `3 days from now` · `2 days ago` · `+3d` / `-1w` / `+90m` · `sep 8` · `december 3 2027` · `12/25/2026` · `next week` · `next month` · `end of week` · `end of day` / `eod` · `tomorrow morning` / `afternoon` / `evening` · `noon` · `midnight`

Text that cannot be understood is rejected with the format hint rather than silently guessed at. Month arithmetic clamps (Jan 31 + 1 month → Feb 28), and a bare time that has already passed today rolls to tomorrow.

### Single occurrences of a recurring series

`calendar_events` update/delete take an `occurrenceDate`. Without it, EventKit always resolves a repeating event to its **first** occurrence, so "cancel next Tuesday's lecture" was previously impossible. With `occurrenceDate` + span `this-event`, exactly one meeting is moved or cancelled and the rest of the series is untouched. `calendar_batch` `cancel-occurrences` does the same for a list of dates.

### Recurrence

Full `EKRecurrenceRule` surface, including `setPositions`, `weeksOfYear`, and `daysOfYear`. "Last Friday of the month" is `frequency: monthly` + `daysOfWeek: [6]` + `setPositions: [-1]`; "3rd Tuesday" is `setPositions: [3]`. These round‑trip on read and are described in the output (`Repeats: month on Fri [last] until 2026-12-31`).

## Prompts

| Prompt | What it does |
| --- | --- |
| `semester-setup` | A course schedule → a full term of recurring class events, deadlines, and alerts, with break weeks skipped |
| `exam-prep-plan` | Study blocks scheduled into real free time before an exam, with an explicit shortfall report if the hours do not fit |
| `assignment-triage` | Course email and notes → dated, prioritized reminders, checked against what is already tracked so nothing duplicates |
| `campus-day-check` | Pre‑flight a day: conflicts, building‑to‑building travel feasibility, weather, and what is due |
| `daily-task-organizer`, `smart-reminder-creator`, `reminder-review-assistant`, `weekly-planning-workflow` | General reminder planning workflows |

The college prompts are written in terms of *capabilities* rather than hard‑coded tool names, so they still read correctly when a server is absent, renamed, or reached through an aggregator.

## Cross‑server coordination

These tools are built to chain with the other servers in the collection. The assistant orchestrates the calls; the shared data shapes make each hand‑off clean. Tool names below are the ones this repo's servers expose directly.

### Travel‑time "leave‑by" alarms (Apple Maps)

Reminders and events accept alarms with a `relativeOffset` in seconds. To be reminded *when you need to leave* rather than when the event starts, get the trip duration from the [`apple-maps`](../apple-maps/) server and set the offset to the negative of that duration.

Example — a class in *Building A* starting at 10:00, leaving from *Building B*:

1. `apple-maps` → `maps_get_directions(origin: "Building B", destination: "Building A", transport: "walking")` returns `expected_travel_time_seconds` (say 600 = 10 minutes).
2. `calendar_events` → `create` the 10:00 event with `location: "Building A"` and an alarm `{ relativeOffset: -600 }`.

The alarm now fires at 09:50 — "time to leave Building B for Building A." Add a buffer (e.g. `-(600 + 120)`) to leave a couple of minutes early.

### Location / geofence alerts (Apple Maps)

Reminder `locationTrigger`s and event/reminder alarm `locationTrigger`s (and an event's `structuredLocation`) take a latitude/longitude. To resolve a place name to coordinates, call `apple-maps` → `maps_search_places` — each result carries `latitude`/`longitude`. Set `proximity: "enter"` to alert on arrival, `"leave"` on departure.

### Weather‑aware events (Apple Weather)

For an outdoor or travel event within ~16 days, pass its location name (or `structuredLocation` coordinates) to the [`apple-weather`](../apple-weather/) `get_forecast` tool to check conditions at the event time. Severe‑weather alerts are US‑only.

### Schedule around the weather (Apple Weather)

To pick *when* to do something outdoors, chain the two searches:

1. `calendar_schedule` → `free-slots` for the open time in the window.
2. `apple-weather` → `find_weather_window` with the same window and the constraints that matter (`max_precipitation_probability`, `min_temperature`, `max_wind_speed`, `daylight_only`). It returns contiguous windows plus a copy‑paste `Start time for scheduling`.
3. Create the event in a slot that appears in both.

When nothing matches, `find_weather_window` names the constraint that eliminated the most hours, so the next call is an informed one rather than a guess.

### Back‑to‑back class feasibility (Apple Maps)

For consecutive events in different buildings, pass each transition to `apple-maps` → `maps_check_campus_hops` with the real gap between them (`available_minutes`). It compares that against the routed travel time plus a buffer and reports the slack, flagging any hop that cannot be made. `maps_compare_travel_times` covers the related question of which of several places is closest, or whether to walk or drive, and hands back a `leave_by_offset_seconds` ready for an alarm's `relativeOffset`.

### Events & reminders from email (Apple Mail)

To turn a message into an event or reminder, fetch it with the [`apple-mail`](../apple-mail/) server (`search_emails` / `get_email_thread`), extract the date, subject, and participants, then create the item here. For a batch of deadlines from one sweep, collect them and use `reminders_batch` `create` in a single call. `apple-mail` → `save_all_attachments` files every matching attachment (filtered by sender, subject, or extension) into a course folder on the way through.

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
- **App‑level default alert preferences** (Calendar ▸ Settings ▸ Alerts) — GUI‑only, with no EventKit API. Per‑item alarms *are* fully settable, including timing, geofence triggers, and sound/email actions.
- **Excluding a date from a recurrence rule** — EventKit has no EXDATE. The supported route, which this server uses, is to detach and remove that single occurrence (`occurrenceDate` + span `this-event`); `create-class-schedule` does it automatically for break ranges.
- **"Procedure" alarm actions (run‑script / open‑URL)** — Apple deprecated these in OS X 10.9 and saving one throws, so they are intentionally not wired. Sound and email alarm actions (`soundName` / `emailAddress`) *are* supported and current.

## License

[MIT](LICENSE) © 2026 Harsh
