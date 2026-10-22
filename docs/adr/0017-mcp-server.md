# ADR 0017: MCP Server

## Status

Accepted

Supersedes (archived): ADR 0027

## Context

AI agents (Claude Code, Cursor, CI bots) review UI changes best when they can read build results
directly instead of scraping the UI. The REST API (`/api/v1`, OpenAPI-described) already exposes
everything needed, with per-project Bearer tokens and exact-match roles (`VIEW_ROLES`,
`DEVELOPER_ROLES`, `APPROVER_ROLES`). The server needs to be reachable by agents without widening what
the API already allows.

## Decision

1. **Standalone package, thin client.** `@storyshelf/mcp` (`packages/mcp`) calls a StoryShelf server over
   `/api/v1` through the shared `httpJson` helper (ADR 0001 Architecture and Conventions). It never
   touches models or the database, so server-side role checks and project scoping apply unchanged and
   the MCP SDK stays out of `@storyshelf/app`.
2. **Two transports, one tool layer.** `createStoryShelfMcpServer(client)` is transport-agnostic. The bin
   runs stdio by default (local agents) and Streamable HTTP with `--http` (remote or shared agents). The
   package exports one subpath beyond the root, `@storyshelf/mcp/http` (`createMcpHttpHandler`,
   `serveHttp`).
3. **Auth.** stdio reads `STORYSHELF_URL`, `STORYSHELF_TOKEN` and `STORYSHELF_SLUG` (the CLI's
   variables). HTTP is stateless and stores no token: each request's `Authorization: Bearer` is
   forwarded upstream, so each caller has their own role. A missing token returns `401` with
   `WWW-Authenticate`; any browser `Origin` is rejected unless allow-listed (DNS-rebinding guard). OAuth
   is out of scope.
4. **Scope: read plus comment.** Tools: `list_projects`, `get_project`, `list_builds`, `get_build`,
   `get_capture_logs`, `list_snapshots`, `get_build_insight`, `get_project_health`, `list_comments`,
   `add_comment`, `resolve_comment`, plus a `review-build` prompt. Approve, reject, retry, insight
   generation and build verdicts (the build-level sign-off, ADR 0013 UI Review) are deliberately not
   exposed: approving and signing off stay human acts, consistent with the advisory-only rule of ADR 0016
   (AI Insights). Insight tools are GET-only and never trigger billed generation. Write tools carry
   `readOnlyHint: false`.
5. **Tools follow the route classes.** The same route table that gates the HTTP API (ADR 0006 Testing
   Option, Hosting-Only Mode and the Database Queue) drives the tool list. Tools that read snapshots or
   insights (`list_snapshots`, `get_capture_logs`, `get_build_insight`, `get_project_health`) are class
   `testing` and absent on an instance without `testing`. Comment tools are class `review`: they work
   with or without `testing`, and answer as not found when the project's review setting is off.
   A tool def carries `routeClass` (unset is `hosting`); the server learns whether the instance has
   `testing` from the `testing` field of the open `GET /api/v1/health` (`probeCapabilities`, read at
   start-up over stdio, at most once a minute over HTTP) and registers only the tools that fit
   (`toolsFor`). An instance that does not answer counts as having `testing`: no tool is hidden on a
   guess. A project with review off is not probed: its comment tools answer 404 per call.
6. **Token-friendly output.** Responses are trimmed to review-relevant fields, `list_snapshots` hides
   unchanged and approved snapshots by default, logs are tailed, and errors map to short actionable
   messages with no upstream bodies.
7. **CLI scaffolding.** `storyshelf mcp init` and `mcp serve` follow the scaffolding convention of ADR
   0001: `init` scaffolds a project (entry, `.env.example`, a ready `.mcp.json` client config, an
   optional Dockerfile); `serve` runs it and maps flags to `STORYSHELF_*`. Status output goes to stderr
   because stdout is the stdio protocol channel.
8. **Docs.** An "MCP server" page in the AI docs section, a package page and a homepage card.

## Alternatives considered

| Option                                     | Why not                                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stdio bin only                             | Excludes remote and hosted agents; HTTP is a thin addition on the same tool layer                                                                  |
| Embedded `/mcp` route in `@storyshelf/app` | Couples the MCP SDK and its releases to the server, enlarges every deployment's surface, risks bypassing REST role checks, poor fit for serverless |
| Expose approve and reject                  | An agent approving visual diffs defeats review; could be added later behind an explicit opt-in flag                                                |

## Consequences

- Reuses auth, roles and OpenAPI; no server changes; one package serves local and remote agents;
  per-caller roles over HTTP.
- An extra network hop and package to publish; limited to what REST exposes (no cross-project listing
  for project tokens); a runtime dependency (`@modelcontextprotocol/sdk`) owned by this package alone.
