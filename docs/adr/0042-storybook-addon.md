# ADR 0042: Read-Only Storybook Addon

## Status

Proposed (draft, 2026-11-03), for owner decision. Part of #455; it narrows the deferred #352 to a
read-only addon and leaves local comparison (#346-#350) out. No code is written until this ADR is
accepted; the implementation issue is filed after that.

## Context

People review visual changes in StoryShelf, but they work in Storybook. A badge beside each story in
the sidebar (unchanged, changed, pending review, design stale) with a link to the review would put
the result where designers and developers already look. The 2026-11-02 parity check (#455) found this a gap against competitors.

An addon runs inside a Storybook that StoryShelf did not write, in the viewer's browser. That raises
three questions that code cannot answer by accident: which origin it runs on, which credential it
sends, and which endpoint it reads. The answers below keep the addon read-only and add no new way to
read a private build.

Facts this ADR builds on:

- A build's published Storybook is served at `/projects/:slug/storybook/build/:buildId/...` on the
  app origin, or at the project's subdomain when `publishedBaseDomain` is set (ADR 0010). The same
  files are readable through a signed `/_s/<token>/` URL, whose token grants static files of one
  build and nothing else (ADR 0007, decision 5).
- The session cookie (`storyshelf_session`) is not scoped to subdomains: no cookie `Domain` is
  configured (ADR 0011). Published files for a signed-in viewer's private build carry no CORS
  headers, so only same-origin pages may read them;
  `publishedCorsHeaders` offers `Access-Control-Allow-Origin: *` only where no credentials are
  involved (public builds, signed URLs).
- A published Storybook is uploaded code. On a subdomain it is isolated from the app's cookies by
  design; on the app origin it already runs with the viewer's session.
- Per-story state exists: snapshot statuses roll up worst-first (`worstStatus`), and a linked
  design's drift is `designDrift`, computed from stored data without calling a provider (ADR 0018).

## Decision

### 1. Where it runs: a Storybook published by StoryShelf, on the app origin

The first release runs only in a build's published Storybook at the canonical path-based URL on the
app origin. It reads the project slug and build id from its own `location.pathname`, so nothing is
injected into the uploaded files and a published build stays byte-for-byte what was uploaded.
The project URLs without a build id, `/projects/:slug/storybook` and the label resolver
`/projects/:slug/storybook/:key/:value`, 302-redirect to `/projects/:slug/storybook/build/:buildId/`,
and Storybook's files are served only under that path. The addon reads the post-redirect pathname, so
it always runs on a path that carries the build id. It supports no other shape.

Everywhere else the addon is inert: it registers no panel and makes no request. That covers a
developer's local `storybook dev`, a Storybook hosted elsewhere, and a project subdomain
(`publishedBaseDomain`). Local use (option b) is deferred (decision 6).

### 2. Auth: the viewer's session, never a stored token

- On the app origin the addon calls the endpoint with `fetch(..., { credentials: "same-origin" })`.
  The browser sends the session cookie; the addon never reads or stores a credential.
- The addon never uses a bearer token, never writes a token to `localStorage`, `sessionStorage` or
  `IndexedDB`, and never accepts one through its options.
- No CORS change. Same-origin needs none, so `publishedCorsHeaders` stays as it is and the addon
  adds no credentialed cross-origin read.
- A project subdomain is not supported in the first release (open question 1). Making the cookie
  reach it (`Domain=`) or answering with `Allow-Credentials` would remove the isolation that gives
  uploaded code on that origin no access to the session.
- Anonymous viewers get no badges: the endpoint needs a signed-in viewer of the project, or an
  instance without sign-in. A build being public shares its Storybook files, not its review state.

### 3. Endpoint: one read-only status route

`GET /api/v1/projects/:slug/builds/:buildId/story-status`

- Class `testing` in `API_ROUTE_CLASSES`: it answers 404 without `options.testing`, like the other
  capture data. The addon first reads `GET /api/v1/health` and stays inert unless `testing` is true.
- Access is the project's viewer rule (ADR 0011), the same one the review pages apply. A private
  build is readable here only by someone who may read the build, and the route follows whatever the
  API answers for a project the caller cannot see.
- The body is per-story state only: for each story id the worst snapshot status across its
  viewports and browsers (`rejected`, `changed`, `new`, `pending`, `approved`, `unchanged`), a design
  drift (`stale`, `deleted`, or absent), and the build's own status. A story with no snapshot (a
  `disableSnapshot` story, or a catalog story the build has no snapshot row for) is omitted, and the
  addon shows no badge for an id that is absent; the implementation tests that omission. It also
  carries a relative `reviewPath` for the build: the path and query of the store's `UrlBuilder` URL
  with the scheme and host removed, which the addon resolves against its own origin. It never carries images, image keys, signed URLs, comments, reviewer identities or
  absolute links.
- Read-only by construction: no other method on the path, no write elsewhere in the addon, and no
  verdicts from Storybook.
- The answer is `Cache-Control: private, no-store`: it depends on who asks, so no cache keeps it. It
  is one request per page load, not per story.

### 4. Packaging

- A new package, `@storyshelf/storybook-addon`, in the fixed version group of ADR 0043. It owns its
  dependencies (Storybook as a peer dependency); no other package depends on it.
- Supported Storybook: 8.6, 9 and 10, matching `fixtures/storybook-{8,9,10}`. The manager API import
  path differs between 8 and 9+, so the package isolates that in one module.
- It must not import `@storyshelf/core` or `@storyshelf/app`. The response type is a small copy
  guarded by a test against the OpenAPI document, so the addon never pulls server code into a
  browser bundle.
- Users add it to `.storybook/main.*`. Adding it changes nothing for a Storybook uploaded elsewhere
  (decision 1).
- The implementation issue verifies it by loading the addon in each fixture's built Storybook.

### 5. Out of scope

Local comparison (#346-#350), any write or verdict from inside Storybook, comments, and a Figma
plugin (#462). MCP is unchanged: the endpoint is for the addon, and MCP already exposes comments.

### 6. Deferred: a developer's local Storybook (option b)

Reading StoryShelf from `storybook dev` needs a credential the browser can hold, and each option has
a cost:

| Option                                         | Risk                                                          |
| ---------------------------------------------- | ------------------------------------------------------------- |
| Device-code flow minting a personal token      | A long-lived read token in the developer's browser storage    |
| Local proxy that holds the token (CLI runs it) | A new local process and port; the token stays out of the page |

None is chosen. The local proxy keeps the token out of the browser and is the likeliest direction,
but it belongs with the local-comparison work, not here.

## Consequences

- Badges appear only in Storybooks opened from StoryShelf. That is the smallest surface that adds no
  credential, no CORS rule and no change to published files.
- A deployment that uses `publishedBaseDomain` gets no badges until open question 1 is settled.
- One new `testing` route needs an OpenAPI entry, a classification row and tests, per AGENTS.md.
- The endpoint returns only what the review pages already show to the same viewer, so it reveals
  nothing new; it adds an API shape to keep stable. A change to it is a change to the addon contract.

## Open questions for owner

1. **Subdomain-published Storybooks.** Recommended: ship without badges there. If wanted, the shape
   is a separate short-lived read grant for this endpoint only (not the `/_s/` token, whose scope
   must not widen), delivered without editing the uploaded files. Is that worth building?
2. **Anonymous viewers of public builds.** Recommended: no badges (decision 2). Should a public
   build show its review state to anyone?
3. **Local `storybook dev`.** Which option in decision 6 do you prefer, or should it wait for the
   local-comparison decision?
4. **Design stale.** It shows only for stories with a linked design (ADR 0018). Keep it in the first
   release, or ship the three review states first?
