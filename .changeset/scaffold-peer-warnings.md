---
"@storyshelf/auth": patch
---

Fixed: `npm install` of a fresh server scaffold no longer prints ERESOLVE peer warnings

`@better-auth/passkey` and `@better-auth/sso` were pinned at 1.7.6 next to `better-auth` 1.7.14, and 1.7.6 wanted an older `@better-auth/utils` than the one `better-auth` brings. All three now sit at 1.7.14, which accepts it. The packed-install smoke fails if the scaffold's install prints an `ERESOLVE` or `npm warn` line.

Schema: none.
