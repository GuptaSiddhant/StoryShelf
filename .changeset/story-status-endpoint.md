---
"@storyshelf/app": minor
---

Added: `GET /api/v1/projects/:slug/builds/:buildId/story-status` for the Storybook addon (ADR 0042)

A read-only `testing` route that answers each story's worst snapshot status (`rejected`, `changed`, `new`, `pending`, `approved` or `unchanged`), a `design` of `stale` or `deleted` only where a linked design is known to have drifted, and the build's status with a relative `reviewPath` from the `UrlBuilder`. It needs a viewer of the project (an anonymous caller gets 404, as does a user without access), answers `Cache-Control: private, no-store` on every response including refusals, sets no CORS headers, and never carries images, image keys, signed URLs, comments or reviewer identities. Stories with no snapshot are omitted. Part of #810; the addon package follows.
