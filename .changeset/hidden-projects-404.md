---
"@storyshelf/app": patch
---

Changed: a caller with no role on a project, signed in or not, now gets `404 Project not found` from its API routes, pages and published Storybook (including the `/_/:id` short link), the same answer as for a project that does not exist, instead of `403`, the page itself or a redirect to sign-in. `403` remains for a member whose role is too low for the action. Browsers now get a not-found page instead of a line of text; for a visitor who is not signed in it has a **Sign in** link, and the sign-in page honours a same-site `return_to` path (password, OAuth, SSO and passkey sign-in) so they land back on the page they were opening.
