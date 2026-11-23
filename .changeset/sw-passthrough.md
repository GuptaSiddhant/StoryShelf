---
"@storyshelf/app": patch
---

Internal: register the app's service worker (ADR 0048)

`GET /sw.js` serves a worker that passes every request to the network and shows an offline placeholder for a failed navigation. It caches nothing. Signing out sends `Clear-Site-Data: "cache", "storage"`.
