# Apple MCP Servers

A collection of local [Model Context Protocol](https://modelcontextprotocol.io/) servers that give an AI assistant native control over Apple apps on macOS — Reminders, Calendar, Mail, Messages, Music, Notes, Maps, and Weather. Everything runs locally on your Mac; no data leaves the machine and no third‑party cloud service is involved.

Each server lives in its own folder and is launched by its own `start.sh`, which builds on change where needed, so editing a server's source deploys on the next launch.

## Servers

| Folder | Server | What it does |
| --- | --- | --- |
| [`apple-events`](apple-events/) | Reminders + Calendar | Reminders, lists (with color), subtasks, calendar events, and calendars (create/update/delete with color) via EventKit |
| [`apple-mail`](apple-mail/) | Mail | Read, search, compose, organize, and analyze email |
| [`apple-messages`](apple-messages/) | Messages | Search, read, and send messages through the Messages app |
| [`apple-music`](apple-music/) | Music | Library, playlists, catalog, playback, and the Up Next queue |
| [`apple-notes`](apple-notes/) | Notes | Create, search, read, update, delete, and organize notes and folders |
| [`apple-maps`](apple-maps/) | Maps | Place search, travel‑time estimates, and Apple Maps links |
| [`apple-weather`](apple-weather/) | Weather | Forecasts, current conditions, alerts, air quality, and more |

## Requirements

- macOS (these servers use native Apple frameworks and automation).
- [uv](https://docs.astral.sh/uv/) for the Python servers (`apple-mail`, `apple-messages`, `apple-music`, `apple-maps`) — it provisions Python and dependencies automatically.
- Node.js + a package manager for the TypeScript servers (`apple-events` uses `pnpm`, `apple-notes` uses `pnpm`, `apple-weather` uses `npm`).
- The relevant privacy permissions the first time each server runs (Reminders, Calendar, Automation, and — for `apple-messages` and some `apple-notes` features — Full Disk Access for the host app).

## Usage

Point your MCP client at each server's `start.sh`. For Claude Desktop, add entries to `claude_desktop_config.json`, for example:

```json
{
  "mcpServers": {
    "apple-events": { "command": "bash", "args": ["/absolute/path/to/apple-events/start.sh"] }
  }
}
```

### Where to put this repo

**Do not keep it in `~/Documents`, `~/Desktop`, or `~/Downloads`.** Those three folders are guarded by their own TCC services, and that check is separate from Full Disk Access. When your MCP client spawns `bash start.sh`, the child process is judged against the folder service, which Full Disk Access on the parent app does *not* satisfy — every server then dies instantly with:

```
/bin/bash: /path/to/start.sh: Operation not permitted
```

Worse, once an app has Full Disk Access, System Settings → Privacy & Security → Files & Folders collapses its per-folder rows into a single greyed-out "Full Disk Access" line, so the Documents toggle can no longer be set at all. Anywhere else in your home directory works with no grant at all.

Quick triage from `~/Library/Logs/Claude/mcp-server-*.log`: `Operation not permitted` (EPERM) is a privacy denial; `Permission denied` (EACCES) is an ordinary file mode.

### Full Disk Access

`apple-messages` reads the Messages database directly, and some `apple-notes` features (checklist state, note links) read the Notes database. Both need Full Disk Access granted to **the app that launches the server** — your MCP client, not the terminal you happen to be in, and not Node.

Grant it in System Settings → Privacy & Security → Full Disk Access, then **fully quit and relaunch** the app; TCC only re-reads the grant at process start. Run the `doctor` tool in `apple-notes` to confirm.

If your client ships a nested helper app, both may appear in the list under the same display name. The one you want is the one that spawns the servers.

### Node runtime and TCC permissions

macOS keys Automation and Full Disk Access grants to a binary's code signature. A Homebrew Node is **ad-hoc signed** (no Team ID), so its signature changes on every `brew upgrade` — and every upgrade silently revokes the grants, which shows up as permissions that "randomly stop working."

Run the servers with a Developer-ID-signed Node from a stable path (the official installer from nodejs.org, rather than a version manager that rewrites the binary in place). `apple-notes`' `doctor` tool reports which runtime you are on and whether it is ad-hoc signed.

## Coordination between servers

The servers are designed to be composed by the client — one server's output feeds another's input. Current cross‑server patterns (see [`apple-events`](apple-events/) for worked examples):

- **Travel‑time "leave‑by" alarms** — `apple-maps` trip duration → a departure alarm on a reminder or event. `maps_compare_travel_times` returns a ready‑made `leave_by_offset_seconds` (already negative, buffer included) to drop straight into an alarm's `relativeOffset`.
- **Location / geofence alerts** — `apple-maps` place search → latitude/longitude for a reminder or event geofence alarm (alert on arrival or departure).
- **Weather‑aware events** — an event's location → `apple-weather` forecast at the event time.
- **Schedule around the weather** — `calendar_schedule` `free-slots` finds open time → `find_weather_window` picks which of those slots is actually dry/warm enough → create the event there.
- **Back‑to‑back feasibility** — consecutive events in different buildings → `maps_check_campus_hops` compares the real gap against travel time and flags anything that cannot be made.
- **Events & reminders from email** — an `apple-mail` message → a calendar event or reminder; `save_all_attachments` files the syllabi and handouts in bulk on the way through.

### Scheduling a semester

`apple-events` carries the planning surface the other servers feed into:

| Need | Tool |
| --- | --- |
| "What does my week look like?" | `calendar_schedule` `agenda` — events + dated reminders merged, with overlap warnings |
| "When am I free for 2 hours?" | `calendar_schedule` `free-slots` — daily window, weekday filter, buffer around commitments |
| "Does this clash?" | `calendar_schedule` `conflicts` — check proposed times before creating anything |
| "Set up my whole term" | `calendar_batch` `create-class-schedule` — recurring class series with break weeks removed automatically |
| "Class is cancelled next Tuesday" | `calendar_events` `occurrenceDate` + span `this-event`, or `calendar_batch` `cancel-occurrences` for several dates |
| "Book 5 hours of study before the exam" | `calendar_batch` `schedule-study-blocks` — places blocks in genuinely free time (`dryRun` first) |
| "Add these 20 deadlines" | `reminders_batch` `create` — one call, per‑item success/failure |
| "Tick these off" | `reminders_batch` `complete` — accepts plain titles, no ID lookup needed |

Four MCP prompts wire these together end to end: **semester-setup**, **exam-prep-plan**, **assignment-triage**, and **campus-day-check**.

Every date parameter across `apple-events` accepts plain language — `tomorrow 3pm`, `next monday`, `friday at 17:00`, `in 2 hours`, `sep 8`, `+3d`, `end of week` — so no timestamp arithmetic is needed before calling a tool.

## License

[MIT](LICENSE) © 2026 Harsh
