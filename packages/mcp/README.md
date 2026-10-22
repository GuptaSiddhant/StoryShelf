# @storyshelf/mcp

MCP server for [StoryShelf](https://github.com/GuptaSiddhant/StoryShelf): let AI agents (Claude Code, Cursor, …) read builds, snapshot diffs, capture logs and AI triage, and comment on reviews. Read-only plus comments; approving stays a human decision.

## Usage

```sh
STORYSHELF_URL=https://shelf.example.com STORYSHELF_TOKEN=... STORYSHELF_SLUG=web npx @storyshelf/mcp   # stdio
STORYSHELF_URL=https://shelf.example.com npx @storyshelf/mcp --http --port 3333                           # HTTP at /mcp
```

Over HTTP each client sends its own `Authorization: Bearer <token>`, which is forwarded to the StoryShelf API. Or scaffold with `storyshelf mcp init`.

## Tools

Read tools cover projects, builds, snapshots and AI insights. The write tools are the review comments, which are `review` routes of the API:

| Tool              | What it does                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_comments`   | Build comments, story comments and per-snapshot threads of a build.                                                                                      |
| `add_comment`     | Adds a comment to a build, optionally anchored to a story (`storyId`) or a snapshot (`snapshotId`), or a reply. Needs a token with `developer` or above. |
| `resolve_comment` | Marks a comment resolved.                                                                                                                                |

A project with [review](https://storyshelf.js.org/guides/review/#review-without-screenshots) off has no comments: these tools fail with 404 for it. Build verdicts (`POST …/reviews`) are deliberately not exposed.

Docs: https://storyshelf.js.org/ai/mcp/ · Design: `docs/adr/0027-mcp-server.md`
