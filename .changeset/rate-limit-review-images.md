---
"@storyshelf/app": patch
"storyshelf": patch
---

Fixed: a second reviewer or CI run no longer gets 429 on snapshot images, health or uploads

Signed-in snapshot-image reads now have their own generous per-address limit, `GET /api/v1/health` is no longer counted in the shared `/api/v1` bucket, and the floor for unauthenticated callers is unchanged. The CLI waits for `Retry-After` and retries a throttled create or upload call up to three times, then fails with an error that names the rate limit and `trustProxy`. The deployment and troubleshooting guides document `trustProxy` and the limits.
