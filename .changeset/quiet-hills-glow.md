---
"@storyshelf/affected": minor
"@storyshelf/ai": minor
"@storyshelf/app": minor
"@storyshelf/auth": minor
"@storyshelf/core": minor
"@storyshelf/db-mysql": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/design-figma": minor
"@storyshelf/image": minor
"@storyshelf/mcp": minor
"@storyshelf/notify-chat": minor
"@storyshelf/notify-email": minor
"@storyshelf/notify-git": minor
"@storyshelf/observability": minor
"@storyshelf/runner-playwright": minor
"@storyshelf/runner-puppeteer": minor
"@storyshelf/storage-azure": minor
"@storyshelf/storage-gcs": minor
"@storyshelf/storage-local": minor
"@storyshelf/storage-s3": minor
"storyshelf": minor
---

Changed: every comment raises one `comment:created`; `review:comment` is a filter alias (#448, #271). Build and story comments used to raise `review:comment` and only snapshot comments `comment:created`. Now every comment raises exactly one `comment:created`, whose payload has `scope` (`build`, `story` or `snapshot`) and `eventId` (the comment id, repeated by a retried delivery so receivers can de-duplicate). A notification channel or subscription that lists `review:comment` still receives build and story comments (not snapshot comments), and one that lists both names receives one message. Webhooks now also receive snapshot comments, and send `X-StoryShelf-Event: comment:created`. A webhook whose `events` lists `review:comment` keeps receiving build and story comments: one shared predicate in core (`matchesEvent`) applies the alias to webhooks, channels and subscriptions.

Fixed: one `review:requested` per review cycle (#449, #271). A repeated publish completion or a retried hook used to send another review request. A build now has a review cycle (`builds.review_cycle`, default 0, incremented when a build goes back to `pending` from `approved` or `rejected`), and the request is claimed once per cycle with an atomic write (`builds.review_requested_cycle`), so a repeat or a second instance sends nothing while a genuinely reopened build sends a new request. The event carries `data.eventId` (`<buildId>:<cycle>`). Both columns are added to existing SQLite, Postgres and MySQL databases on start (defaults 0 and null).

Added: the component page can show one build, `?build=<id>` (#451, #271). The page used to show only the newest build that has the file. With `?build=` it shows that build's states, stories, results and story comments, with a banner (and a **Show latest** link) when it is not the newest; tabs and links keep the parameter, and History rows pick a build. A build that is not the project's, or does not exist, answers 404 and never falls back to the newest build; a valid build without the file says so and shows no states. Links from build and review pages pass their build. Without the parameter nothing changes.

Added: change requests on review comments (#464, #437). A comment can now be marked a change request (`kind: "change_request"` on `POST …/comments`, or **Request a change** in the forms). Developers, approvers, admins and the build's author resolve and reopen it (`POST …/comments/:commentId/resolve` and `…/reopen`; a viewer gets 403); `comments` gains `kind`, `resolved_at` and `resolved_by` on all three databases. The build page shows the count of open change requests beside the verdict and a checklist linking to each anchor, and **Approve build** asks for confirmation while some are open. They are advice only: they never block approval or change a status. `comment:created` carries the `kind`.
