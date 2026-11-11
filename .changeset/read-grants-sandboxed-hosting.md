---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Added: sandboxed Storybook hosting mode and `/_r/` read grants for private builds

`storybookHosting: { mode: "sandboxed" }` (ADR 0051) answers every uploaded file of the project path and the short links with `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms`, so a Storybook runs its scripts on an opaque origin, apart from the app's DOM, storage and cookies, whether it is framed or opened directly. A sandboxed page sends no cookie, so a signed-in viewer of a private build is redirected (`302`, `private, no-store`, `no-referrer`) from the canonical path to `/_r/<token>/<file>`, a read grant: one build, one hour, signed with its own key and verified with the current secret only. Renewal is a fresh redirect through the canonical path, which checks permission again. Public builds are served directly with `Access-Control-Allow-Origin: *`. `trusted` stays the default and is unchanged. `subdomain` is still refused at boot.

Component-page previews of private builds now load through `/_r/` grants and no longer need `testing`; the preview-token refresh route is a `hosting` route. `redactSecrets` and the request log scrub `/_r/<token>` like `/_s/<token>`.

Security: `/_s/` accepts capture tokens only. A token with no purpose, as older interactive previews were minted, or a read grant is refused with the same `404`. Preview frames open before this release must reload. The `read` and `capture` tokens use separate derived keys, and `/_r/` and `/_s/` share one per-IP rate-limit bucket (`storybookUrlRateLimit`).
