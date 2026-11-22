---
"@storyshelf/common": minor
---

Added: @storyshelf/common holds the shared settings, HTTP, redaction and tracing (#1334)

A new public package with `/settings`, `/http`, `/redact`, `/tracing`, `/errors`, `/ids` and `/logger` subpaths. Its only runtime dependency is `@opentelemetry/api`, so a package that needs only this code no longer has to install `@storyshelf/core`.

Schema: none.
