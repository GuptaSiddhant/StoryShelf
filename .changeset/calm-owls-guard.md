---
"@storyshelf/app": minor
---

Security: writes that carry a session cookie must come from the portal

A `POST`, `PUT`, `PATCH` or `DELETE` that carries a session cookie (`storyshelf_session`, `__Secure-storyshelf_session` or `__Host-storyshelf_session`) is now refused with `403` unless its `Origin` is the portal origin or the browser sends `Sec-Fetch-Site: same-origin` or `none` (ADR 0051, decision 9). It covers every path, `/api/v1` included, which the per-route CSRF token covers for page routes only. `same-site` is not accepted: every content host of `subdomain` hosting is the same site as the portal and serves uploaded pages, and `SameSite=Lax` still sends the cookie on such a request. In `subdomain` mode the portal origin is the configured `publicBaseUrl`. A request with no session cookie, such as a CLI or CI call with a bearer token, is not affected, and neither are reads. A script that calls the API with a browser session cookie and no `Origin` must send `Origin: <portal origin>` or use a token.

Logout also clears the `__Host-storyshelf_session` cookie over https.
