---
"storyshelf": patch
"@storyshelf/affected": patch
"@storyshelf/ai": patch
"@storyshelf/app": patch
"@storyshelf/auth": patch
"@storyshelf/core": patch
"@storyshelf/db-mysql": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/mcp": patch
"@storyshelf/observability": patch
"@storyshelf/runner": patch
"@storyshelf/storage-azure": patch
"@storyshelf/storage-gcs": patch
"@storyshelf/storage-local": patch
"@storyshelf/storage-s3": patch
"@storyshelf/storybook-addon": patch
---

Fixed: published packages carry only shipped export targets and declare every import

The published `package.json` of each library now has the dist-only `exports` (same keys, no `source` condition that points at the omitted `src/`), and no source maps ship (more than half of core's and app's unpacked size). `@storyshelf/core` declares `vitest` as an optional peer for `test-helpers`, `@storyshelf/auth` declares `drizzle-orm` as a peer, and `@storyshelf/observability` depends on both OTLP exporters it imports. `@storyshelf/mcp` no longer exports `.` (importing it started the CLI; the `storyshelf-mcp` bin stays) and ships types for `./http`; the `storyshelf mcp init` stdio scaffold now starts the bin. A CI gate in `packed-install` fails when a packed `exports` or `bin` target is missing, a `source` condition ships or a source map ships.

Schema: none.
