# Apple Music MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for **Apple Music** on macOS — browse your library, manage playlists, search the catalog, and control playback. No Apple Developer account required.

Part of the [Apple MCP Servers](../README.md) collection.

## Capabilities

- **Library** — browse and search your saved songs, albums, artists, and playlists.
- **Catalog** — search the Apple Music catalog.
- **Playback** — play/pause, skip, and control the Music app.
- **Queue** — inspect and manage the Up Next queue.
- **Playlists** — create and modify playlists.
- **Discover** — recommendations and discovery helpers.
- **Config** — sign‑in and configuration for the account in use.

## Requirements

- macOS with the Music app and an Apple Music subscription for catalog/playback features.
- Automation permission for Music (macOS prompts on first use).

## Running

```bash
bash start.sh
```

`start.sh` uses [uv](https://docs.astral.sh/uv/) to provision Python and dependencies, then launches the server over stdio (`applemusic-mcp serve`).

## License

[MIT](LICENSE) © 2026 Harsh
