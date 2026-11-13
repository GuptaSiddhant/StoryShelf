---
"@storyshelf/app": minor
"@storyshelf/core": minor
"@storyshelf/auth": minor
---

Added: `subdomain` Storybook hosting, one content host per build

`storybookHosting: { mode: "subdomain", baseDomain }` (ADR 0051) serves a build at `<build-id>.<baseDomain>` and nothing else: the host label is the lower-case build id, the portal serves no uploaded bytes, a content host sends no sandbox header and answers no portal or API path, and a `Host` that is not the portal, a content host or an alias host answers `404`. `<project-slug>.<baseDomain>` redirects to the portal's `/projects/<slug>/storybook`. Boot refuses `subdomain` without `publicBaseUrl`, with a non-https portal (a `localhost` name may use http), when `baseDomain` would also match the portal host, or with sign-in on and no `secret`.

A private build is opened through the portal: a navigation is redirected to `/_x/<exchange-token>/` on the content host, which sets the host-only `__Host-storyshelf-grant` cookie (a sealed value naming the build and its one-hour expiry, re-checked on every request) and redirects to the clean URL. The exchange token (purpose `exchange`, 60 seconds) is accepted only there, for that host's build, and only for a navigation. Private answers carry `Cross-Origin-Resource-Policy: same-origin` and `private, no-cache` with an `ETag`. Private previews open the content host in a new tab. `createShelfAuth({ hostSessionCookie: true })` names the portal session cookie `__Host-storyshelf_session`, which `subdomain` requires when sign-in is on; switching the mode signs everyone out once.

Changed: `publishedBaseDomain` is read as `{ mode: "subdomain", baseDomain }` and logs a deprecation warning; the two-level `<build>.<slug>.<domain>` links are gone. Project slugs that are a reserved label (`www`, `api`, `app`, `admin`, `auth`, `static`) or a build-id shape get a `-project` suffix.

Security: `redactSecrets` scrubs `/_x/<token>` like `/_s/` and `/_r/`; `/_x/` shares the signed URLs' per-IP rate-limit bucket.
