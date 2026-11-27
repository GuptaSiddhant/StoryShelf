---
"@storyshelf/app": patch
---

Fixed: the OpenAPI document's `info.version` is the server's release, not a fixed 1.0.0

`GET /api/v1/openapi.json` said `"version": "1.0.0"` whatever release served it. It now reports the running `@storyshelf/app` version (the same value `GET /api/v1/health` reports), and the website's published `/openapi.json` carries the version it was built from.
