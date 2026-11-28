---
"@storyshelf/mcp": patch
"storyshelf": patch
"@storyshelf/app": patch
---

Fixed: MCP tool list and errors match the server, and init finds a workspace's Storybook

The MCP server hides the AI tools (`get_build_insight`, `get_project_health`) when the instance reports no AI: the liveness body (`GET /api/v1/health`) gains an `ai` flag, read as on when an instance has no flag, as for `testing`. `list_projects` with a project token answers with that token's own project when `SHELF_SLUG` names it, and otherwise says a project token cannot list projects. The 403 reason no longer mentions comments. `storyshelf init` at a monorepo root names the workspace package that holds a `.storybook` (from `package.json#workspaces` or `pnpm-workspace.yaml`, one level deep, no crawl) and points at the CI guide's `working-directory`. Bare `storyshelf` with no config prints one short line instead of the full help.
