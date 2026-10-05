---
title: Published Storybook
description: Share the latest Storybook — path-based URLs, per-project subdomains, and public-branch access control.
---

Beyond diff review, StoryShelf **publishes** the uploaded Storybook build as a browsable site for designers and PMs.

![Projects list — published Storybook is the latest build per branch](/screenshots/projects-list.png)

## URL structure

All three are the same published artifact — the **latest published build** for the project (most recent build whose branch is public). They are resolvers that 302 to a canonical build-scoped path that serves assets:

- `GET /projects/:slug/storybook` — latest on default branch
- `GET /projects/:slug/storybook/:key/:value` — latest bearing that label (`pr/42`, value is wildcard, URL-encoded)
- `GET /projects/:slug/storybook/build/:buildId/...` — canonical — serves `iframe.html`, `index.json`, `assets/*.js`, etc.

Path-style labels keep `/` safe: `branch=feature/foo` round-trips as `…/labels/branch/feature/foo` without slug collision. Label values are `encodeURI`-ed, wildcard-captured, and not slugified.

Build-specific assets live only under `/build/:buildId/...` so label resolution never collides with Storybook’s nested `assets/foo.js`.

## Public vs auth gate

A build is **public** iff `builds.public = true` or `builds.git_branch` matches `projects.public_branch_regex` (e.g. `^main$`, `^release-`). Public builds are viewable **without auth**; all others require at least `viewer` membership (see [Roles](/concepts/roles/) and [Auth](/guides/auth/)). Unauthenticated users can still review public published Storybooks while review stays gated.

Retention keeps the latest build per branch, so the latest *published* build on a branch survives purge; if it is purged, the URL falls back to the next-most-recent public build (or 404).

## Subdomains (optional)

Opt in via `publishedBaseDomain` (e.g. `stories.example.com`) plus a wildcard DNS (`*.stories.example.com → your.server`) and wildcard TLS cert. Subdomains serve the Storybook at the **domain root** — no asset-path rewriting (Storybook expects root).

- `:slug.stories.example.com` — latest published on default branch
- `:buildId.:slug.stories.example.com` — a specific build

Subdomains serve **published Storybooks only** — the review UI stays on the main domain at `/projects/:slug/...`. Labels are not exposed as subdomains (DNS labels can’t contain `/`). Without `publishedBaseDomain`, path-based URLs are the only surface (default for `localhost`).

Configure:

```ts
createShelfApp({
  config: { publishedBaseDomain: "stories.example.com" },
});
```

The `linkRoute()` helper switches between path and subdomain forms based on config.

## Related

- [Projects](/concepts/projects/) — `public_branch_regex` setting
- [Labels](/concepts/labels/) — stable `/:key/:value` URLs
- [Roles](/concepts/roles/) — viewer access for published Storybooks
- Guides: [Deployment](/guides/deployment/docker-compose/) (subdomains DNS), [Auth](/guides/auth/)
