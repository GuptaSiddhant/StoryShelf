---
"@storyshelf/core": patch
"@storyshelf/db": patch
---

Internal: define the settings, token, connection and notification tables as neutral tables

ADR 0041 task 3a, batch 3 (#1225). `site_settings`, `schema_meta`, `tokens`, `user_invite_tokens`,
`user_connections`, `webhooks`, `notification_channels` and `notification_subscriptions` are
defined once in `@storyshelf/core/db`, and the generation-diff gate covers them. One new
difference is classified: only SQLite's `ddl.ts` indexes `user_invite_tokens.user_id`, while the
neutral table indexes it in every dialect (a non-unique index, an ADR 0053 expand step once the
tables are wired). No adapter uses the factories yet, so no schema or runtime behaviour changes.
