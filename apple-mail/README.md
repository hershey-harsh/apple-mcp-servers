# Apple Mail MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives an AI assistant full access to **Apple Mail** on macOS — read, search, compose, organize, and analyze email.

Part of the [Apple MCP Servers](../README.md) collection.

## Capabilities

- **Read & browse** — list inbox, read messages and full threads, per‑mailbox unread counts, inbox dashboard/overview.
- **Search** — search across accounts and mailboxes; find messages awaiting a reply or needing a response.
- **Compose & reply** — compose new mail, reply, reply‑all, forward, **redirect** (re‑send preserving the original sender), and manage drafts (including rich‑text drafts).
- **Organize** — move messages between mailboxes, create and **delete** mailboxes, mark read/unread, flag with colors, mark **junk / not junk**, and manage Trash.
- **Attachments** — list, save, and export message attachments and sources.
- **Signatures** — list the signatures configured in Mail's settings.
- **Analyze** — statistics, top senders, and account overviews.

## Requirements

- macOS with the Mail app configured with at least one account.
- Automation permission for Mail (macOS prompts on first use).

## Running

```bash
bash start.sh
```

`start.sh` uses [uv](https://docs.astral.sh/uv/) to provision Python and dependencies, then launches the server over stdio. Edits under the source tree take effect on the next launch.

## License

[MIT](LICENSE) © 2026 Harsh
