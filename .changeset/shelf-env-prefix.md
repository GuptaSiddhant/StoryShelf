---
"@storyshelf/core": minor
"@storyshelf/app": minor
"@storyshelf/auth": minor
"@storyshelf/mcp": minor
"@storyshelf/observability": minor
"@storyshelf/runner-playwright": minor
"storyshelf": minor
---

Breaking: StoryShelf's own environment variables use the SHELF_ prefix (no aliases)

Every setting StoryShelf defines is now `SHELF_*`: `SECRET` is `SHELF_SECRET`, `ADMIN_TOKEN` and
`STORYSHELF_ADMIN_TOKEN` are `SHELF_ADMIN_TOKEN`, `AUTH_PASSWORD` is `SHELF_ADMIN_PASSWORD`,
`STORYSHELF_URL` is `SHELF_URL`, `AWS_BUCKET`/`S3_BUCKET`/`BUCKET_NAME` are `SHELF_S3_BUCKET`, and
so on (#1308). Names a platform or SDK defines (`PORT`, `DATABASE_URL`, `AWS_REGION`, `OTEL_*`, …)
are unchanged. The full table is in the upgrading guide.

The old names are not read. So that an upgrade cannot silently drop a setting, the server, the CLI
and the MCP server refuse to start while any old name is set, listing each with its new name and
never a value. Rename the variables before upgrading. `storyshelf server init` and the Terraform
modules write only the new names.

Schema: none.
