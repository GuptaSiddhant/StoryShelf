# Published Storybook

> Part of the [StoryShelf architecture spec](./README.md).

## Published Storybook

Beyond diff review, StoryShelf publishes the uploaded Storybook build as a browsable site, so designers and managers can look at components without touching CI or code.

- Each build's `storybook/{buildId}/` statics are served as the browsable Storybook.
- **Publishing does not depend on `testing`** (ADR 0006, decision 10; `core/src/capture/publish/`). A zip up to `maxInlineUnzipSize` (default 50 MB, counted while the upload streams) is extracted inline in the upload request; a larger one becomes a `publish` job on the database queue (`capture_jobs`), run by a consumer that every instance with a database starts at `lifecycle.setup()` and drains at `teardown()`. The file-by-file route (`/dedup`, `/content`, `/manifest`) needs no extraction and completes publishing when the manifest is stored. On a serverless host (`AWS_LAMBDA_FUNCTION_NAME`, `VERCEL`, `NETLIFY`) no consumer runs and an over-limit zip is refused with `413` pointing to the file-by-file route. Extraction is capped (`maxZipEntries` default 50 000, `maxUnzippedBytes` default 2 GiB, stream-counted) and refuses absolute and `..` paths.
- **Acceptance when publishing ends** (`publishVerdict`, the single owner of the rule): with no capture to run, a published build on the project's default branch becomes `approved`, a failed publish makes it `failed`, and a non-default build becomes `approved` when the project has review off (`projects.review_enabled = false`) and stays `pending` for a build-level verdict otherwise. No approval event or webhook fires, and a build that left `pending` is never touched again. With a capture to run, publishing leaves the status to capture. `afterPublish` hooks (`PublishCompleter`) run after every publish for later features such as the catalog.
- **`testing` gates the app** (ADR 0006, decisions 1, 3 and 8). `Store.testing` is `options.testing !== undefined`; `requireTesting` (`app/src/middleware/require-testing.ts`, mounted after `setupGate` and before the CSRF and rate-limit guards) takes the class of the last classified route Hono matched (`classOfRoute`) and answers 404 for `testing` routes when it is off (JSON under `/api/`, text elsewhere). Navigation (`projectNavItems`, settings tabs, the build table's Review button) hides what is off; the System page shows a notice with `countHiddenSnapshots`; `runBootTasks` logs the mode (`logHostingOnlyMode`); the create-build response carries `testing`, which `storyshelf upload` reports. `resolveShelfOptions` requires `runner` with `testing` (`testing: {}` throws; there is no `testing.queue`) and refuses `testing` on a database whose metadata says `supportsTesting: false` (D1); `assertServerless` (core) refuses `testing.runner` on AWS Lambda and warns on Vercel and Netlify, unless `STORYSHELF_ALLOW_SERVERLESS=1`.
- **The catalog** (`core/src/capture/catalog/`; ADR 0006, decision 9): the first `afterPublish` hook (`createCatalogHook`) reads the published `index.json` (`stories.json` on older Storybooks; test entries left out), writes the `build_components` rows and then `catalog.json` (the marker that cataloguing finished), whatever the build's verdict and with `testing` on or off. `createCatalogLoader` serves a build's catalog from `catalog.json` through an in-process LRU keyed by build id and catalogues a build without one lazily from its persisted statics; a build with no readable index has no catalog and its pages say so. Retention removes the rows with the build and the file with the build's prefix.
- **Library, component and build pages read the catalog** in both modes; `testing` (`testingEnabled()` in `app/src/store.ts`: `Store.testing`, true when `options.testing` is set) layers snapshot data onto them. The library shows the latest build of the branch whatever its status.
- **Component preview** (`ui/preview-embed.tsx`): click-to-load, in an `<iframe sandbox="allow-scripts">` (no `allow-same-origin`) created from an inert `<template>` by the shell script, so opening a page never runs a published Storybook. A sandboxed frame has an opaque origin, so its module scripts are cross-origin requests without cookies: published files answer `Access-Control-Allow-Origin: *` exactly when the build is viewable without credentials (public build, or an instance without sign-in); a private build under sign-in is not embedded (the page offers the link out). Storybook 8, 9 and 10 render under this sandbox.
- The **published** Storybook for a project (`GET /projects/:slug/storybook`) is its latest `approved` build on the project's default branch (`BuildModel.latestApprovedDefault`; `app/src/routers/storybook.ts`); with none the route answers 404. Who may open a build is a separate check: a build is public iff `builds.public = true` or `builds.git_branch` matches `projects.public_branch_regex` (e.g. `^main$`, `^release-`; `isPublicBuild`).
- **Access control:** a public build is viewable **without auth**. Every other Storybook requires auth and at least `viewer` membership on the project (ADR 0011).
- **Retention:** published builds follow the same purge rules as any other build. Retention keeps the most recent build per branch and every build bearing a `persistent` label, and purges older terminal builds past the TTL (see Retention). The published build is the latest _approved_ default-branch build, so it survives purge when it is also the branch's most recent build; if a newer build that is not approved sits above it, it can be purged once past the TTL, and the published URL then falls back to the next-most-recent approved default-branch build (or 404 until a new build lands).

### URL structure

A published Storybook is addressed by **build** or **label** (`build` is a reserved segment, not a valid label key):

- `GET /projects/:slug/storybook` latest published on the default branch
- `GET /projects/:slug/storybook/:key/:value` latest build bearing that label (`:value` is a wildcard; values are URL-encoded)
- `GET /projects/:slug/storybook/build/:buildId/...` a specific build — the canonical path that serves assets

`/storybook` and `/storybook/:key/:value` are **resolvers** that 302-redirect to `/storybook/build/<id>/`; Storybook files (`iframe.html`, `index.json`, `assets/*.js`, `sb-manager/*`, …) are served only under `/storybook/build/:buildId/...`. This keeps label resolution from colliding with static-file serving — Storybook emits nested paths like `assets/foo.js` that are otherwise indistinguishable from a `key/value` label. The public/auth check from ADR 0011 applies to all three.

### Subdomain hosting and legacy links

With `storybookHosting: { mode: "subdomain", baseDomain }` (ADR 0051, decision 5) the app routes by
`Host` (`hostDispatch`): the portal is the configured `publicBaseUrl`, a build is served at the root of
`<build-id>.<baseDomain>` (lower-case ULID), and `<project-slug>.<baseDomain>` is an alias host. Any other
host answers 404. The portal never serves uploaded bytes in this mode, but every path link above stays a
valid entry point (#360):

| Old link                                         | Subdomain mode                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `/projects/:slug/storybook[?query]`              | resolver → canonical path → content host of the latest approved default build     |
| `/projects/:slug/storybook/:key/:value[?query]`  | resolver → canonical path → content host of the latest build with that label      |
| `/projects/:slug/storybook/build/:id/<path>[?q]` | `302` to `<id>.<baseDomain>/<path>?q`; `?storyId=` becomes the manager's `?path=` |
| `/_/:buildId/<path>[?q]` and `/_/:slug/<path>`   | `302` to that build's content host, `<path>` and query kept                       |
| `<slug>.<baseDomain>/<anything>[?q]`             | `302` to the portal's `/projects/:slug/storybook?q` (the path is not kept)        |

Every hop checks `publishedAccess` on the portal first, so a private link keeps its access rules: a public
build goes straight to its content host; a private one goes through the 60-second `/_x/` exchange, which
sets that host's own one-hour `__Host-storyshelf-grant` cookie; a viewer with no role gets what a missing
build gets (#497). Only navigations are redirected; a script or fetch of a legacy path gets the identical
404, so an old `<script src>` or `fetch()` to a path URL stops working. Redirect targets are built from
configuration and the re-encoded path, never from the request's `Host`, so no path or query can send a
viewer to another host. A slug link follows the newest approved build; a build-id link stays on its build.

Migration and rollback: switching to `subdomain` signs everyone out once (the portal cookie becomes
`__Host-`) and turns path links into redirects; switching back to `trusted` or `sandboxed` makes them serve
in place again, while content-host and alias links stop serving builds: outside `subdomain` mode the app does not route by `Host`, so the operator removes the wildcard hosts from the proxy, or they reach the portal. The two-level `<build-id>.<slug>.<domain>` shape of the retired
`publishedBaseDomain` is not routed in any mode (ADR 0051, decision 6).
