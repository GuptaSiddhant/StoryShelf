---
"@storyshelf/app": minor
---

Changed: a build has one page; the overview now redirects to the review page

The build page is the review stage with a header (branch, sha, status, author, message and one summary line), Approve all / Reject all, Open Storybook and a ⋯ menu for Retry capture and Cancel build. The stat cards, "Changes in this build", the stale-baseline notice, test results, capture attempts and the review state move into a details panel that starts collapsed; a stale baseline also shows a one-line warning with Re-diff in the header. The overview's snapshot grid, bulk-action card and per-snapshot buttons are gone, so each scope has one approve path: the bottom bar and the `a`/`r` keys for a snapshot, the header for the whole build. `GET /projects/:slug/builds/:buildId` answers a 302 to `/projects/:slug/builds/:buildId/diff`, keeping the query string; the page route is now classed `both`, so a hosting-only instance shows the same page without the stage (review only).
