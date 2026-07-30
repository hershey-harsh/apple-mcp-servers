# Apple Notes MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for **Apple Notes** on macOS — create, search, read, update, delete, and organize notes and folders via AppleScript. All operations are local.

Part of the [Apple MCP Servers](../README.md) collection.

## Capabilities

- **Notes** — create, read, update, append to, move, and delete notes; get content as markdown, plaintext, or HTML; fetch metadata and note links.
- **Folders** — create, rename, move, and delete folders, including nested folder paths.
- **Search** — search titles or full content, filter by folder or modified date, with result limits.
- **Attachments** — list, fetch, and save note attachments.
- **Checklists** — read checklist done/undone state (requires Full Disk Access).
- **Accounts & sync** — list accounts, target a specific account, and check iCloud sync status.

## Requirements

- macOS with the Notes app.
- Automation permission for Notes (macOS prompts on first use).
- **Full Disk Access** for the host app is required only for reading checklist state (it reads the NoteStore database directly); everything else works without it.

## Running

```bash
bash start.sh
```

`start.sh` installs dependencies with `pnpm` if needed, rebuilds when the source changes, and runs `build/index.js`.

## Notes on Apple Notes

Apple Notes stores checklists as a paragraph style inside a gzipped protobuf blob that AppleScript's `body` interface does not expose, so a real interactive checklist cannot be *created* programmatically — create a bulleted list and convert it in the app with **⇧⌘L**. Checklist *state* can be read back once items exist.

## License

[MIT](LICENSE) © 2026 Harsh
