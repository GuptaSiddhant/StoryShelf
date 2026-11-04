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
- The **published** Storybook for a project is the most recent build whose branch is public. A build is public iff `builds.public = true` or `builds.git_branch` matches `projects.public_branch_regex` (e.g. `^main$`, `^release-`).
- **Access control:** a public build is viewable **without auth**. Every other Storybook requires auth and at least `viewer` membership on the project (ADR 0011).
- **Retention:** published builds follow the same purge rules as any other build. Because retention keeps the most recent build per branch, the latest public build on a branch survives purge; if it is purged, the published URL falls back to the next-most-recent public build (or 404 until a new build lands).

### URL structure

A published Storybook is addressed by **build** or **label** (`build` is a reserved segment, not a valid label key):

- `GET /projects/:slug/storybook` latest published on the default branch
- `GET /projects/:slug/storybook/:key/:value` latest build bearing that label (`:value` is a wildcard; values are URL-encoded)
- `GET /projects/:slug/storybook/build/:buildId/...` a specific build — the canonical path that serves assets

`/storybook` and `/storybook/:key/:value` are **resolvers** that 302-redirect to `/storybook/build/<id>/`; Storybook files (`iframe.html`, `index.json`, `assets/*.js`, `sb-manager/*`, …) are served only under `/storybook/build/:buildId/...`. This keeps label resolution from colliding with static-file serving — Storybook emits nested paths like `assets/foo.js` that are otherwise indistinguishable from a `key/value` label. The public/auth check from ADR 0011 applies to all three.

### Subdomains (optional)

For sharing, a published Storybook can also be served on a **per-project subdomain** — opt-in via `publishedBaseDomain` (e.g. `stories.example.com`) plus a wildcard DNS record (`*.stories.example.com`) and a wildcard TLS cert:

- `:slug.stories.example.com` → latest published Storybook on the default branch
- `:buildId.:slug.stories.example.com` → a specific build

Subdomains serve the Storybook at the domain **root**, so no asset-path rewriting is needed (Storybook's static build expects root serving). They serve **published Storybooks only** — the review UI stays on the main domain at `/projects/:slug/...`. Label values are not exposed as subdomains (DNS labels cannot contain `/`); labels remain on the path-based URLs above. Without `publishedBaseDomain`, the path-based URLs are the only published surface (and stay the default for `localhost` and hosts without a wildcard record). The URL builder (`createUrlBuilder`) switches between path and subdomain forms based on config, but it only builds links: the app does no host-based routing, so a reverse proxy in front of it must deliver the wildcard hosts (native routing is #358; ADR 0010).
