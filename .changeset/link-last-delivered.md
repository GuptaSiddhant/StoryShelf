---
"@storyshelf/core": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
---

Added: a repository link records when delivery last posted through it

Delivery stamps `git_repository_links.last_delivered_at` after the host accepts a build's statuses, so a project can see that a link works. The stamp touches nothing else (not `updated_at`, not the state), and a failed stamp is logged, not retried, because the status is already out.

Schema: adds the nullable column `git_repository_links.last_delivered_at` (`TEXT`, `TIMESTAMPTZ`, `DATETIME(3)`) in all three dialects. It is an expand step: the previous release ignores it, and existing links read `null` until their next delivery.
