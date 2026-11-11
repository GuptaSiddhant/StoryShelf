---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Added: `storybookHosting` setting with boot validation, and revalidated private Storybook caching

`config.storybookHosting` (`{ mode: "trusted" | "sandboxed" | "subdomain" }`, ADR 0051) is validated at boot: an unknown mode, extra keys, `baseDomain` on the wrong mode, `publishedBaseDomain` set beside it, or `sandboxed` / `subdomain` with sign-in on and no `secret` stop the server, and a broken value never falls back to `trusted`. Until their serving lands, `sandboxed` and `subdomain` are also refused at boot rather than served as `trusted`. Unset keeps today's `trusted` behavior. `storybookUrlRateLimit` is now a top-level option that works without `testing`; `testing.storybookUrlRateLimit` stays as an alias.

Security: a signed-in viewer's private build files are now `private, no-cache` with a content-hash `ETag` and `304` on a match, replacing `private, max-age=31536000, immutable`. A shared or browser cache can no longer keep a revoked viewer's copy fresh. Public builds and signed URLs are unchanged.
