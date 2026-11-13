---
"@storyshelf/app": patch
---

Security: four page forms (create and delete project, comment mentions) now need a CSRF token (#786)

An audit of every state-changing route found `POST /projects/new`, `POST /projects/:slug/delete`, `POST /projects/:slug/builds/:buildId/mention-suggest` and `.../mention-complete` outside the CSRF token check. The same-origin rule (ADR 0051, decision 9) already refused them cross-site; they now also need the session-bound token, like every other page form. The app's own forms send it, so browsers see no change; a script that posts these forms with a session cookie must send `x-csrf-token` (from any page's `X-CSRF-Token` header or `csrf-token` meta tag). A route-matrix test now fails when a new cookie-authenticated write lacks protection.
