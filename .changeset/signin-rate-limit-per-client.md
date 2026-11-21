---
"@storyshelf/app": patch
"@storyshelf/auth": patch
---

Security: sign-in rate limiting is per client, not shared

The auth engine's limiter keyed every request on one value, so three anonymous sign-in attempts every 10 seconds made every user's sign-in answer 429. The app now sets the engine's client address from its own client-IP resolver (`trustProxy` rules, never copied from the request), on forwarded requests and on the `/api/auth/*` mount, and the engine reads only that header.

Schema: none.
