---
"@storyshelf/app": minor
---

Breaking: sign-in and sign-up posts must come from the portal too

Closing login CSRF: a `POST` to `/auth/engine/login`, `/api/auth/sign-in/*` or `/api/auth/sign-up/*` is judged by the same rule even with no session cookie, so a cross-site form cannot sign a visitor in as someone else. A script that signs in over HTTP with no `Origin` (for example `curl`) now gets `403`; send `Origin: <portal origin>`.
