---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Over https the CSRF token is bound to the signed-in session again, and the profile page marks the current device again: the app read the session cookie as `storyshelf_session` only, but the auth engine names it `__Secure-storyshelf_session` on https. One `readSessionCookie` helper in `@storyshelf/core/types` prefers the `__Secure-` name and falls back to the plain one.
