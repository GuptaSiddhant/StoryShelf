---
"@storyshelf/core": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
---

Internal: push_subscriptions table (ADR 0048).

Schema: expand-only (ADR 0053). Adds the table `push_subscriptions` (`id`, `user_id`, unique `endpoint`, `p256dh`, `auth`, `label`, `created_at`, `last_success_at`, `failure_count`) in SQLite, Postgres and MySQL, deleted with its user; nothing is dropped or altered, and the previous release ignores it.

Core gains the `PushSubscriptionRow` type and `PushSubscriptionModel` (add or replace by endpoint, list by user, delete, record success or failure). Nothing reads the table yet; the endpoint and keys must never be logged.
