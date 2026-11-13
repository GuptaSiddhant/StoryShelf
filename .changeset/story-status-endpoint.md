---
"@storyshelf/app": minor
"@storyshelf/storybook-addon": minor
---

Added: read-only Storybook addon with per-story review badges (ADR 0042)

`@storyshelf/storybook-addon` shows each story's review state (unchanged, changed, new, pending review, approved, rejected, and design stale or deleted) beside it in the sidebar of a Storybook published by StoryShelf, linking to the build's review. It supports Storybook 8.6, 9 and 10, reads with the viewer's session cookie only (no token, no CORS change), never writes, and does nothing in a local `storybook dev`, on a project subdomain or in a sandboxed page.

It reads a new endpoint, `GET /api/v1/projects/:slug/builds/:buildId/story-status`, a `testing` route that answers each story's worst snapshot status, a `design` of `stale` or `deleted` only where a linked design is known to have drifted, and the build's status with a relative `reviewPath` from the `UrlBuilder`. An anonymous caller or a user without access gets 404. Every answer is `Cache-Control: private, no-store`, sets no CORS headers and never carries images, image keys, signed URLs, comments or reviewer identities. Stories with no snapshot are omitted. Closes #810.
