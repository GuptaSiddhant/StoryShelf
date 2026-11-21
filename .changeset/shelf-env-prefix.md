---
"@storyshelf/core": minor
"@storyshelf/app": minor
"@storyshelf/auth": minor
"@storyshelf/mcp": minor
"@storyshelf/observability": minor
"@storyshelf/runner-playwright": minor
"storyshelf": minor
---

Changed: StoryShelf's own environment variables use the SHELF_ prefix; old names still work

Every setting StoryShelf defines is now `SHELF_*`: `SECRET` is `SHELF_SECRET`, `ADMIN_TOKEN` and
`STORYSHELF_ADMIN_TOKEN` are `SHELF_ADMIN_TOKEN`, `AUTH_PASSWORD` is `SHELF_ADMIN_PASSWORD`,
`STORYSHELF_URL` is `SHELF_URL`, `AWS_BUCKET`/`S3_BUCKET`/`BUCKET_NAME` are `SHELF_S3_BUCKET`, and
so on (#1308). Names a platform or SDK defines (`PORT`, `DATABASE_URL`, `AWS_REGION`, `OTEL_*`, …)
are unchanged. The full table is in the upgrading guide.

Old names keep working through one alias table in `@storyshelf/core/config` (`readSetting`). Boot
logs one warning per old name in use, `{ old, new }`, never the value. An old and a new name set to
different values refuse to boot, naming both variables. `storyshelf server init` and the Terraform
modules write only the new names. Old names stay accepted until at least the third minor release
after 1.0.

Schema: none.
