# ADR 0027: MCP Server (`@storyshelf/mcp`, thin client over `/api/v1`)

## Status

Accepted

## Context

AI agents (Claude Code, Cursor, CI bots) review UI changes best when they can read build results directly instead of scraping the UI. ADR 0026 §11 deferred the MCP server and its tools (`get_build_insight`, `get_project_health`) to a follow-up. The REST API (`/api/v1`, OpenAPI-described) already exposes everything needed, with per-project Bearer tokens and exact-match roles (`VIEW_ROLES`, `DEVELOPER_ROLES`, `APPROVER_ROLES`). No MCP dependency exists in the repo.

## Decision

1. **Standalone package, thin client.** `@storyshelf/mcp` (`packages/mcp`) calls a StoryShelf server over `/api/v1` through the shared `httpJson` helper (ADR 0019). It never touches models or the database, so server-side role checks and project scoping apply unchanged and the MCP SDK stays out of `@storyshelf/app`.
2. **Two transports, one tool layer.** `createStoryShelfMcpServer(client)` is transport-agnostic. The bin runs **stdio** by default (local agents) and **Streamable HTTP** with `--http` (remote/shared agents). The package exports one new subpath, `@storyshelf/mcp/http` (`createMcpHttpHandler`, `serveHttp`), approved here.
3. **Auth.** stdio reads `STORYSHELF_URL` / `STORYSHELF_TOKEN` / `STORYSHELF_SLUG` (the CLI's variables). HTTP is **stateless and stores no token**: each request's `Authorization: Bearer` is forwarded upstream, so each caller has their own role. Missing token → `401` with `WWW-Authenticate`; any browser `Origin` is rejected unless allow-listed (DNS-rebinding guard). OAuth is out of scope for v1.
4. **v1 scope: read + comment.** Tools: `list_projects`, `get_project`, `list_builds`, `get_build`, `get_capture_logs`, `list_snapshots`, `get_build_insight`, `get_project_health`, `list_comments`, `add_comment`, `resolve_comment`, plus a `review-build` prompt. **Approve/reject/retry and insight generation are deliberately not exposed**: approving stays a human act (consistent with ADR 0026's advisory-only rule). Insight tools are GET-only and never trigger (billed) generation. Write tools carry `readOnlyHint: false`.
5. **Token-friendly output.** Responses are trimmed to review-relevant fields, `list_snapshots` hides unchanged/approved snapshots by default, logs are tailed, and errors map to short actionable messages (no upstream bodies).
6. **CLI scaffolding.** `storyshelf mcp init` / `mcp serve` mirror `server`/`worker` (ADR 0016): `init` scaffolds a project (entry, `.env.example`, a ready `.mcp.json` client config, optional Dockerfile); `serve` runs it, mapping flags to `STORYSHELF_*`. Status output goes to stderr because stdout is the stdio protocol channel.
7. **Docs.** An "MCP server" page in the AI docs section, a package page, and a homepage card.

## Alternatives considered

| Option | Why not |
|---|---|
| Stdio bin only | Excludes remote/hosted agents; HTTP is a thin addition on the same tool layer |
| Embedded `/mcp` route in `@storyshelf/app` | Couples the MCP SDK and releases to the server, enlarges every deployment's surface, risks bypassing REST role checks, poor fit for serverless |
| Expose approve/reject | An agent approving visual diffs defeats review; can be added later behind an explicit opt-in flag |

## Consequences

**Positive:** reuses auth, roles and OpenAPI; no server changes; one package serves local and remote agents; per-caller roles over HTTP.

**Negative:** an extra network hop and package to publish; limited to what REST exposes (no cross-project listing for project tokens); a new runtime dependency (`@modelcontextprotocol/sdk`) owned by this package alone.

## Links

- `docs/adr/0016-server-scaffolding-over-rigid-package.md` — scaffolding precedent
- `docs/adr/0019-shared-http-helper.md` — outbound HTTP rule
- `docs/adr/0026-ai-insights-engine.md` — advisory-only rule; §11 deferral
