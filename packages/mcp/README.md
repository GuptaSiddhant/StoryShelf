# @storyshelf/mcp

MCP server for [StoryShelf](https://github.com/GuptaSiddhant/StoryShelf): let AI agents (Claude Code, Cursor, …) read builds, snapshot diffs, capture logs and AI triage, and comment on reviews. Read-only plus comments; approving stays a human decision.

```sh
STORYSHELF_URL=https://shelf.example.com STORYSHELF_TOKEN=... STORYSHELF_SLUG=web npx @storyshelf/mcp   # stdio
STORYSHELF_URL=https://shelf.example.com npx @storyshelf/mcp --http --port 3333                           # HTTP at /mcp
```

Over HTTP each client sends its own `Authorization: Bearer <token>`, which is forwarded to the StoryShelf API. Or scaffold with `storyshelf mcp init`.

Docs: https://storyshelf.js.org/ai/mcp/ · Design: `docs/adr/0027-mcp-server.md`
