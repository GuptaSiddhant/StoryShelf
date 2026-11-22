---
"@storyshelf/core": patch
---

Changed: core re-exports the shared settings, HTTP, redaction and tracing from common (#1334)

`readSetting`, `httpJson`, `HttpError`, `redactSecrets`, `withSpan` and the rest moved to `@storyshelf/common` and are still exported from the same `@storyshelf/core/utils`, `/config`, `/telemetry` and `/logger` subpaths. The Storybook token prefixes live in `common` too; signing and verifying stay in core.

Schema: none.
