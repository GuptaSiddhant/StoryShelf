---
"@storyshelf/observability": minor
---

Breaking: observability no longer re-exports the database and storage wrappers (#1334)

`createInstrumentedDatabase` and `createInstrumentedStorage` need core adapter types, so they are exported only from `@storyshelf/core/telemetry`. Everything else (`withSpan`, propagation, instruments, the middleware and the SDK entry) stays, and the package now depends on `@storyshelf/common` instead of core.

Schema: none.
