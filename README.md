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

## Coordination between servers

The servers are designed to be composed by the client. For example, to build a travel‑time aware reminder ("remind me when I need to leave"), ask `apple-maps` for the trip duration and use it to set a departure alarm on the reminder or event — see [`apple-events`](apple-events/) for a worked example.

## License

[MIT](LICENSE) © 2026 Harsh
