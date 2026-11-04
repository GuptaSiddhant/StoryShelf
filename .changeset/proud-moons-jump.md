---
"@storyshelf/mcp": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
---

The upgrade check now also refuses a hand-made `projects.run_a11y` or `snapshots.a11y_violations` column of another type, naming the table and column; the MCP `get_project` tool describes the `runA11y` setting it returns; the docs say that upgrading turns accessibility checks on for existing projects.
