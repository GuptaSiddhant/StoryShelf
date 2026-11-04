# AI insights

> Part of the [StoryShelf architecture spec](./README.md).

## AI Insights

Optional, advisory-only AI (ADR 0016). `ShelfOptions.ai` (an `Ai` singleton like `Auth`, implemented by `@storyshelf/ai`) switches it on site-wide; `projects.ai_profile` (NULL = off) is the per-project gate, set by site admins. Evidence is assembled deterministically in `core/insights` (redacted, size-capped, ranked), sent through a named profile's model, and the answer is validated against a fixed envelope and rendered as plain text.

- **Tables:** `insights` (triage per build, health per project window; `pending → running → done | failed`, unique key dedupes concurrent runs), `ai_usage` (provider-reported tokens, survives build purge; budgets and hourly limits are counted from it), `ai_budget_alerts` (`day:threshold` primary key = once-per-day alert claim).
- **API:** `/api/v1/projects/{slug}/builds/{buildId}/insights[/latest]` and `/api/v1/projects/{slug}/insights/health`; guard order `501 → 409 → role → 429`; `200` cached, `202` + poll.
- **Jobs:** in-process, tracked for graceful teardown; runs stuck > 30 min are marked `interrupted`.
- **Retention:** build-linked rows go with their build; health rows and usage rows are purged after 90 days.
