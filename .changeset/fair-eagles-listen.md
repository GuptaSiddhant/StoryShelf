---
"@storyshelf/app": patch
---

Fixed: the health report no longer says `ok` when an adapter it does not probe failed its boot check (#544). `POST /api/v1/health` and the admin System page used to list only the adapters they probe (database, storage, capture runner, design, notifiers, email), so a failed AI, auth or images setup left the status at `ok`. Such a failure now appears as its own `failed` entry with its category, kind and a sanitized detail, and the overall status becomes `degraded`. The response shape is unchanged, and a successful setup adds nothing.
