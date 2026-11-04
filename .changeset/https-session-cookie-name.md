---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Over https the CSRF token is bound to the signed-in session again, and the profile page marks the current device again: the app read the session cookie as `storyshelf_session` only, but the auth engine names it `__Secure-storyshelf_session` on https. One `readSessionCookie` helper in `@storyshelf/core/types` prefers the `__Secure-` name and falls back to the plain one.

The CSRF token no longer carries the session cookie's value (it was `<session>:<time>:<signature>` and is rendered into pages, so a script could read the HttpOnly cookie from it); it is now `csrf:<time>:<signature>`, and tokens issued before still verify.
