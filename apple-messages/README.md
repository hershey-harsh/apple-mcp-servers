# Apple Messages MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for the macOS **Messages** app — search, read, and send messages (iMessage and SMS).

Part of the [Apple MCP Servers](../README.md) collection.

## Capabilities

- **Read** — recent messages, individual chats, and group conversations.
- **Search** — plain and fuzzy search across message history; search attachments.
- **Send** — send a message to a contact or phone number/handle.
- **Contacts** — look up contacts and check iMessage availability for a handle.
- **Attachments** — list and retrieve message attachments (images returned inline where possible).

## Requirements

- macOS with the Messages app signed in.
- **Full Disk Access** for the host application (e.g. your MCP client) — reading the Messages history requires access to the local `chat.db`. Grant it in *System Settings → Privacy & Security → Full Disk Access*, then restart the host app.
- Automation permission for Messages to send.

## Running

```bash
bash start.sh
```

`start.sh` uses [uv](https://docs.astral.sh/uv/) to provision Python and dependencies, then launches the server over stdio.

## License

[MIT](LICENSE) © 2026 Harsh
