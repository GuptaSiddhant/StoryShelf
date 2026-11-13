---
"@storyshelf/core": minor
"@storyshelf/auth": minor
"@storyshelf/app": minor
---

Added: daily retention for insights, AI usage, expired sessions and verifications (#866)

The daily retention sweep now deletes insight rows older than 180 days (`insightsTtlDays`), AI usage rows older than 400 days (`aiUsageTtlDays`, long enough for every budget window; it was 90) and session and verification rows 7 days after they expire (`expiredAuthTtlDays`). Each setting takes `null` to keep the rows. Deletes run in bounded batches, and the sweep now runs even when branch GC is off.
