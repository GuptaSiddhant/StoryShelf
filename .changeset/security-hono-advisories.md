---
"@storyshelf/app": patch
"@storyshelf/observability": patch
---

Security: require hono 4.13.16 or later, which fixes five hono advisories

The `hono` range moves from `^4.11.0` to `^4.13.16`, so an install can no longer resolve a version
with these advisories: GHSA-46wx-v44x-9hh2 (`csrf()` and hyperlink auditing), GHSA-4h7h-rv7c-7m2v
(`validator('form')` and multipart), GHSA-4m76-xfj5-7975 (`mount()`), GHSA-h7mg-cq63-vhpq
(RegExpRouter and wildcard middleware) and GHSA-3gg2-335m-rxc6 (`css` helper).

Reachability in StoryShelf: GHSA-h7mg-cq63-vhpq is the one that applies. The app uses hono's
default router and puts `sameSiteWrites`, `setupGate`, `hostDispatch` and others on `app.use("*")`,
so a request whose path carries an encoded line terminator could have skipped them. The only
multipart body is `POST /api/v1/projects/{slug}/builds/{buildId}/content` (`routers/builds.ts`).
Its declared schema is `z.any()` and the handler reads `c.req.formData()` itself and verifies every
file by content hash, so the validator skip in GHSA-4h7h-rv7c-7m2v removes no check the app relies on.
The app has its own `csrf` (`middleware/csrf.ts`), never `hono/csrf`, and calls no `mount()`, so
GHSA-46wx-v44x-9hh2 and GHSA-4m76-xfj5-7975 are not reached. `css` templates take static values only,
so GHSA-3gg2-335m-rxc6 is not reached.

The repository's own lockfile also moves `@hono/node-server` (the MCP SDK's 1.19.17 copy, for
GHSA-jpvv-r467-5p4w and GHSA-rmxm-3fg6-px4f) to 2.1.11, `fast-xml-parser` to 5.12.1
(GHSA-474x-hrwr-fgx4) and `astro`, for the website, to 7.4.13 (GHSA-mh32-jxcr-mh9f and
GHSA-r3h5-4585-7x3w). Those are lockfile changes and change no published range.
