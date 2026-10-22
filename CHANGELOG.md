# Changelog

All notable changes to StoryShelf. Versions follow the fixed-version scheme from
`scripts/release.mjs` (every workspace package shares one version).

## Unreleased

**Added: merge gate v2 — GitHub App check runs, per-snapshot annotations and `storyshelf protect` (ADR 0014, decision 13; #27, #32, #33, #35).** A GitHub git channel can show a build as **check runs** posted by a GitHub App instead of commit statuses: channel config `mode: "checks"` with `appId` and `installationId`, the App's private key (PEM) as the channel secret (encrypted at rest, never returned by the API or UI, scrubbed from logs; the form has a mode select, App ID, installation ID and key fields). `notify-git` signs the App JWT with `node:crypto` and caches the installation token per channel (no new dependency, no PAT). The run mirrors the build (`queued`, `in_progress`, `completed` as `success`, `failure`, `cancelled`, or `neutral` for a failed Storybook publish), is keyed by head SHA and the external id `storyshelf:<name>` and is updated, never duplicated. `<prefix>/testing` carries one annotation per `new` or `changed` snapshot linking to its review page (new `UrlBuilder.snapshot`, `…/builds/<id>/diff?snapshot=<id>`), posted in batches of 50, at most 200, with "and N more" in the summary. GitLab keeps statuses. `statusesForBuild` gains `changes` (input) and `progress`, `informational`, `annotations`, `omitted` (on `DesiredStatus` and the `status` target); `MAX_ANNOTATIONS` and `StateAnnotation` are exported from `@storyshelf/core/adapter/notifier`. New CLI command `storyshelf protect` prints the required-check rule, validates the branch's existing rule through the GitHub or GitLab API and writes it only with `--apply` (dry run by default; needs an admin token). `redactSecrets` also scrubs JWTs. Label, branch and component-path URL encoding is now per segment (`?` and `#` in a value no longer break the path); the "A git channel needs a token" error now reads "needs a token or private key". Docs: merge-gate guide (GitHub App setup, protect helper), notify-git, CLI, notifications.

**Changed: owner decisions on the follow-ups of #275, #278, #280, #282, #284 and #291.** A render pass no longer dies at the 24 hour signed-URL ceiling: a pass whose budget would outlast its token is rendered in slices of stories (`renderInSlices`), each with a freshly minted Storybook URL (#279). The component page's preview frame of a private build asks `GET /api/v1/projects/:slug/builds/:buildId/preview-token` (class `testing`) every 40 minutes and re-points itself to a new one-hour token, so a page left open keeps working. The build page shows "Waiting for the Storybook to publish" in place of the verdict form until publishing ends (the `409` stays the server guard, #282). Accessibility findings gain a build-level total (an **Accessibility findings** card on the build page, `a11y N` in the review header) and an `A11y` filter on the snapshot list; they stay information only (#280). On boot, once adapters are ready with notifiers wired and a public origin resolved, the git state of open builds (newest 25 per project) is requested again, so a restart cannot leave a merge gate stale (#284). The MCP server advertises the `testing` tools (`list_snapshots`, `get_capture_logs`, `get_build_insight`, `get_project_health`) only when the instance has `testing`, read from the new `testing` field of `GET /api/v1/health` (#291).

**Added: a real `cancelled` build status (ADR 0006, 0013, 0014; #287).** Cancelling a build (`POST …/cancel`, **Cancel build**) now ends it `cancelled`, not `failed`. `cancelled` joins `BUILD_STATUSES` (zod and OpenAPI enums, the MCP `list_builds` filter, the build list filter chips) and `TERMINAL_BUILD_STATUSES` (purged like failed builds); no database migration is needed, the column is text. It is terminal by construction: `BuildModel.update`/`setStatus` refuse any other status for a cancelled build (the row comes back unchanged, logged at debug), `CaptureAttemptModel` leaves an attempt a cancel closed as `cancelled`, `finalizeBuild` skips a cancelled build and the orchestrator does not start capturing one, so a capture that ends after the cancel can no longer move the build (the late-write window of #287 is gone). Verdicts and snapshot approvals on a cancelled build answer `409` and the build page hides the verdict card. **Retry** resets it to `pending` (new `BuildModel.resetStatus`). A cancel raises the new `build:cancelled` webhook and notification topic (not on by default) and no `build:failed` or capture-failed alert. `statusesForBuild` has a case for it: `NotifierState` gains `cancelled`, shown as GitLab `canceled` and GitHub `error` with the description `Cancelled` on `<prefix>/testing` and `<prefix>/review`, and the pull-request comment says `Cancelled`. A cancelled build without a published Storybook reads `failure` on `<prefix>/storybook`.

**Breaking: `testing.queue` is gone; `testing` requires `runner` (ADR 0006, decision 6; #257).** The database queue is the only queue, so there is no enqueue-only instance, `testing: {}` throws, and the Lambda/Vercel/D1 checks apply to every `testing` instance. The `captureQueue` slot of the adapter lifecycle goes with it. The `CaptureQueue` and `PollableCaptureQueue` interfaces and the contract suite stay.

**Changed: a detected public origin is used only once an admin confirms it; authentication keeps the request's address (ADR 0007, decision 6; ADR 0014, decision 12; #267).** What an admin's browser reports is stored unconfirmed and no longer resolves, so no notification, email link, commit status or signed Storybook URL rests on it until it is confirmed on **System** (which now says so). `PUBLIC_BASE_URL` and platform addresses count as confirmed. OAuth redirect URIs and `/.well-known/openid-configuration` use the new `resolver.authOrigin(requestOrigin)`: the confirmed origin, else the request's own. `ResolvedPublicOrigin.confirmed` is removed (always true).

**Changed: a remote browser target that needs a signed Storybook URL is unavailable without a secret or a confirmed origin, and the URL is the directory root (ADR 0007, decision 5; #273).** The reasons now say what to set (`NO_SECRET_REASON`, `NO_ORIGIN_REASON`); settings saves naming such a target are refused and a build that reaches one fails at once with the reason. `storybookBase` accepts only `<origin>/_s/<token>/` (no `iframe.html`, query or fragment) and the runners refuse any other form before connecting.

**Changed: axe runs on the primary target only; `parameters.a11y` loses function values quietly (ADR 0004, decision 6; #241, #242).** The first entry of a project's `browsers` list is scanned (`primaryTargetOf`), the other targets are not, and the review page, filmstrip and component card name the browser the findings come from. A function value in `parameters.a11y` (and a rule item that held only one) is dropped and axe runs with the rest, with one debug log line; `inPageReadA11yParameters` now returns `{ params, dropped }`.

**Fixed: capture honours the configured zip caps and records its content in `content_refs` (#253).** Capture-side extraction (single build and shards) used built-in caps; it now takes `maxZipEntries` and `maxUnzippedBytes` (`CaptureJobOptions.limits`). Content persisted by capture or by a zip publish is counted in `content_refs`, so retention no longer treats it as unused.

**Changed: git channels in hosting-only mode, and `notify-git` is documented as dependency-free (ADR 0014; #263).** `notify-git` needs a confirmed public origin and works in hosting-only mode, where it posts `<prefix>/storybook` (and `<prefix>/review`) for published builds; the git channel form is offered there too.

**Added: cancel a build; a configurable, heartbeat-kept lease (ADR 0006; #248, #251).** `POST /api/v1/projects/:slug/builds/:id/cancel` (class `testing`, developer role and above) and **Cancel build** on the build page (shown while the build is `pending`, `capturing` or `comparing`) cancel the build's jobs of every kind, queued or running (`CaptureQueue.cancel(buildId)` on the database queue now covers `capture`, `publish` and `notify` jobs, not only the queue's polled kinds), close its open capture attempts and end the build through the normal status announcement (`cancelled` since the entry above, first `failed`). The MCP server stays read and comment only. New option `testing.leaseSeconds` (default `300`) sets the database queue's lease, and a running job now renews it on a timer (every `min(30 s, lease / 3)`) as well as on progress, so a stage that prints nothing for longer than the lease is no longer redelivered while its process is alive; a dead holder's lease still expires. New `CANCELLABLE_BUILD_STATUSES` in `@storyshelf/core/types`.

**Changed: notifications are paused until a public URL is set; runners leave signals to the host; the dead in-process-queue check is gone (ADR 0014, decision 12; #265, #259, #261).** While the public origin resolver (ADR 0007, decision 6) finds no origin, nothing is sent: git statuses and the pull-request comment are neither queued nor delivered inline, and message notifications (project and review events, site-wide `sys:*` alerts, per-user subscriptions) are skipped, because each carries a link. No channel is marked as errored; **System**, the project notification settings and the profile show "Notifications are paused until a public URL is set", and one `warn` line is logged at boot and on the first skipped notification. When an admin confirms or reports the first origin, builds still `pending`, `capturing`, `comparing` or `reviewing` are requested again (`requestOpenBuildStates`); with `PUBLIC_BASE_URL` set at start-up delivery resumes with the next state change. `statusesForBuild` now requires absolute `urls` (the relative-link fallback and `urls: null` are removed), `BuildStateDeps.publicOrigin` is required and `config.publicBaseUrl` is no longer read there, and `notifyCaptureFailed` takes the resolver as an optional fifth argument. Webhooks carry ids only and stay as they are. `@storyshelf/runner-playwright` and `@storyshelf/runner-puppeteer` launch with `handleSIGINT`, `handleSIGTERM` and `handleSIGHUP` off, so a graceful drain finishes in-flight captures instead of failing them with `TargetClosedError`; each render closes its own browser. `isStuckCapture` and the "interrupted captures" notice of the compute-jobs page are removed.

**Changed: review verdicts need a user, wait for publishing and raise `build:pending`; `<prefix>/review` shows progress and closes when review is turned off (ADR 0013, decision 3; ADR 0014, decision 5; #269, #271).** A verdict is attributed to the signed-in user or to the owner of the API token that posted it; with authentication on, a caller that is no user (the bootstrap admin token, a token without an owner) gets 403. Only an instance with no authentication records an anonymous verdict (`user_id` stays nullable for that case), and only while the project requires one approval; with `reviewApprovals` above 1 it answers 409. A verdict answers 409 until the build's Storybook is published (one shared probe, `publishingOf`, also behind `<prefix>/storybook`). A verdict that sends a build back to `pending` now raises `build:pending` (webhook and notification topic). The `<prefix>/review` description shows approval progress (`Waiting for approvals: 1 of 2`), and a project with review off posts a final `success` (`Review is off`) for accepted builds, so a pull request is not left with a stale `pending` status after the switch-off pass.

**Changed: signed Storybook URLs follow the owner's review (ADR 0007, decision 5; #275, #255).** The route and the minted URL move from `/s/<token>/` to `/_s/<token>/` (`STORYBOOK_TOKEN_PREFIX`, one constant for the auth gate, the route table, `redactSecrets` and the minted URLs; it cannot meet the `/_/:id` short link). The token module is the single owner of signing, verification and the derived key (`signStorybookToken`/`verifyStorybookToken` take a `SecretInput`, so a rotation pair needs no unwrapping by callers), and one policy (`publishedAccess`: signed token, public build or signed-in viewer) with one file handler (`servePublishedFile`) now serves the published Storybook routes (`/projects/:slug/storybook/build/:id/*`, `/_/:id/*`) and the signed route alike. The route has a per-IP rate limit counted before the token is read (default 6000 requests a minute, `testing.storybookUrlRateLimit`; `429` with `Retry-After`). The token lifetime is derived from the pass (its render budget plus 5 minutes, at least 2 hours, at most 24) and can be overridden per project: new nullable column `projects.storybook_url_ttl_seconds` (DDL and Drizzle schema in the SQLite, Postgres and MySQL packages, `Project.storybookUrlTtlSeconds`, the fake tables), `storybookUrlTtlSeconds` on `PATCH /api/v1/projects/:slug` (60 to 86400, `null` clears it) and a field under project Settings -> Capture. Removed: the option `testing.storybookUrlTtl` and the `STORYSHELF_CAPTURE_STORYBOOK_URL_TTL` variable the forked child read; the lifetime now follows each job. Published files answer `Access-Control-Allow-Origin: *` for public builds and every signed URL (never with credentials; refusals and a signed-in viewer's private build carry none), `previewCorsHeaders` is replaced by `publishedCorsHeaders`, and the component page now frames a private build under sign-in through a one-hour signed URL when the instance has `testing` and a `secret` (otherwise it keeps the Open link).

**Added: signed Storybook URLs for remote browsers that cannot route back (ADR 0007, decision 5; #228).** A `reach: "url"` target (every Puppeteer remote target, CDP-only services, BrowserStack) now renders: for each render pass and for the parameter pre-pass the job mints `<publicOrigin>/s/<token>/` and passes it as `storybookUrl`. The token (`signStorybookToken`/`verifyStorybookToken`, `@storyshelf/core/utils`) is `base64url("<projectId>:<buildId>:<expiresAt>")` plus an HMAC-SHA-256 under a key derived from `secret` with the context `storyshelf/storybook-url/v1`; it grants read access to one build's static files and nothing else. New route `GET /s/:token/*` (class `testing`; no session, CSRF or rate limit; one identical `404` for every refusal; `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `nosniff`; `previousSecret` verifies during a rotation and never signs; empty, `.`, `..`, backslash and NUL path segments are refused). New option `testing.storybookUrlTtl` (seconds, default `7200`, `60` to `86400`; a signed token claiming more than 24 hours is refused). The token is scrubbed from the request log, the OpenTelemetry `url.full` attribute, attempt logs, failure text and the `err` serializer (`redactSecrets` knows `/s/<token>`). `offeredTargets` now describes a target that works: `reach: "url"` targets stay `unavailable` ("no secret", "no public origin") until both exist. The remote provider sees the URL (BrowserStack records visited URLs); see the Remote browsers guide.

**Added: remote browsers (ADR 0007, decisions 1 to 5; #226).** The runners can connect to a browser on another machine instead of launching one. `@storyshelf/runner-playwright/remote` exports `remote({ name, engines, connect, sessions })` and the presets `playwrightServer` (a self-hosted `playwright run-server`, `exposeNetwork` on by default), `azurePlaywright` and `browserstack`; `@storyshelf/runner-puppeteer/remote` exports `cdp`. They go in the runner's `browsers` list and offer one `<engine>@<name>` target per engine (`chromium@grid`) with its own baselines, never compared with a local render. Presets are plain configuration (no vendor SDK) and validate when the runner is created: a bad name, an engine the connection cannot serve, a non-WebSocket endpoint or two entries with one target throw. Playwright uses `browserType.connect(endpoint, { headers, exposeNetwork })` (or `connectOverCDP` for a CDP connection), Puppeteer `puppeteer.connect`; with `exposeNetwork: "<loopback>"` the remote browser reaches the loopback Storybook server through the connection, so such a target needs no public origin. The environment of a remote render is measured inside the browser (browser version, OS, device pixel ratio and a digest of a fixed 44-font probe list), never from the host, so a provider-side image change is diffed and not waved through as an environment migration. A target's `sessions` is its page cap, shared per target across the process (`sessionGateFor`; an explicit `concurrency` can only lower it). Connection-level failures (refused, dropped, timed out, no capacity, 429 and 5xx) are retried with exponential backoff before the render or crash isolation sees them; what is left fails the job at once as a `TargetLaunchError`, which carries the new `transient` flag (a service that is merely down stays offered; refused credentials and a Playwright version mismatch, which names both versions, mark the target unavailable). Endpoints, query values and header values never appear in messages or logs. `render` and `extractParameters` accept `storybookUrl`, the URL a `reach: "url"` target's browser opens instead of the loopback server; nothing mints it yet, so such targets (BrowserStack, every Puppeteer remote target) cannot render until signed Storybook URLs (#228). New guide "Remote browsers" with the self-hosted farm setup, pinned to the `playwright-core` version (a test fails when the page drifts) and what a bare `run-server` guards: no authentication (the `--path` is the only gate) and `--max-clients` queues extra connections instead of refusing them. `CaptureEnvironment.platform` is the browser's OS for a remote render. The `test:integration` suites of both runners now run a remote capture against a real `run-server` (Playwright) and a separate Chrome over CDP (Puppeteer).

**Added: the review UI, the `review` route gate, review events and retention for unfinished reviews (ADR 0013, decisions 1, 2, 4, 8, 9 and 10; #233, #234, #235, #236).** The build page now holds the review: a **Review** card (where the build stands, approvals against the requirement, each reviewer's latest verdict and note, and Approve/Reject for approvers and admins), **Changes in this build** (the components added, removed and changed against the latest accepted build of the branch, else of the default branch, from the `build_components` hashes; `GET /api/v1/projects/:slug/builds/:buildId/changeset` returns the same data) and the build and story comments. With `testing` off these are the page's content; with `testing` on the changeset sits above the visual diffs. A component page shows the story's comments of the build it shows, with a form for `developer` and above, and the snapshot review thread includes the comments on its story. Project admins edit the switch and the approvals under **Settings → General → Review**. The `review` route class is now enforced: `requireReview` answers 404 for every route classed `review` (comments, verdicts, the changeset and the review forms) of a project with review off, on each request, and `assertReviewEnabled` is gone. Every OpenAPI operation carries `x-storyshelf-class`. The MCP server's `add_comment` takes `storyId`; there is still no verdict tool. Three events join the webhook and notification topics: `review:requested` (a published build waits for a verdict; on by default for the project's approvers and admins by email, off per user by disabling their subscription or leaving the topic out), `review:comment` (build and story comments; snapshot comments keep `comment:created`) and `review:verdict`. Retention now also purges `pending` builds whose last activity (upload, comment or verdict) is older than `purgeTtlDays`, and turning review off (settings form or `PATCH`) accepts the project's pending builds with no capture attempts or snapshots in one pass, without an approval event. The comment, resolve and verdict forms post to page routes under `/projects/:slug/builds/:id/` because a browser form cannot send the JSON the API requires (the forms posted to the API and got 415).

**Added: build-level review and verdicts (ADR 0013, decisions 1 to 3 and 5; #230, #231, #232).** New columns `projects.review_enabled` (default `true`) and `projects.review_approvals` (default `1`), `comments.story_id` and the table `build_reviews` (`buildReviews` in `Tables`; DDL and Drizzle schema in the SQLite, Postgres and MySQL packages; new columns reach existing Postgres and MySQL databases only when recreated). The project API reads and patches the two project settings (`reviewEnabled`, `reviewApprovals`); a comment can anchor to a story (`storyId`, not together with `snapshotId`). `GET` and `POST /api/v1/projects/:slug/builds/:id/reviews` give a build a verdict (approver and admin; viewers read) and answer 404 for a project with review off. With `testing` off the verdicts decide a build through the pure `deriveReviewStatus`: `approved` once the required approvals are present among each reviewer's latest verdict and none is `rejected`, `rejected` when any is, `pending` otherwise; with `testing` on a verdict is a sign-off and the snapshot rollup keeps deciding. `publishVerdict` now also accepts a published non-default build when the project has review off (no approval event or webhook); with review on, and by default, such a build stays `pending` until verdicts approve it, which changes what existing hosting-only projects see for pull-request builds (the default branch is never held). A verdict that approves or rejects a build announces it like any status change (`build:approved` / `build:rejected` webhook, notifications, git channels); `refreshBuild` and verdicts share `announceBuildStatus`. `<prefix>/review` is now posted for projects with review on when `testing` is off (the build's `pending`, `approved`, `rejected` or `failed` as `pending`/`success`/`failure`), next to `<prefix>/storybook`; the git flags read the project's switch instead of a constant.

**Added: capture targets and the runner's `browsers` list (ADR 0007, decisions 1, 3 and 7; #225).** A project's `browser`/`browsers`, a snapshot's `browser` and every baseline key hold a **capture target**: an engine (`chromium`) or `<engine>@<name>` for a remote browser (`CaptureTarget`, `parseTarget`, `engineOf`, `TARGET_NAME_PATTERN` in `@storyshelf/core/adapter/capture-runner`). `createPlaywrightCaptureRunner` and `createPuppeteerCaptureRunner` take `browsers` (bare engine names and `local(engine, options)`, default `["chromium"]`, first = default); duplicates, an empty list, an unknown engine, `local("firefox")` on Puppeteer and bare `"chrome"` on Puppeteer without an `executablePath` throw when the runner is created. At startup each local target is checked without launching anything and reported as `ready` or `unavailable` with a reason in `metadata.targets` (`RunnerTarget`: `target`, `reach`, `status`); **System → Capture browsers** lists them. The project API (`browser`, `browsers`), the General and Capture settings and the capture itself take targets: saving a target the runner does not offer or that is unavailable is refused with `400` and the reason, and a build of a project that already names one fails at once. A launch that fails marks its target unavailable and fails the job with the launch error (`TargetLaunchError`) instead of being isolated and retried as a story crash. The render input carries `target` instead of `browser`. Bare `"chrome"` is real Chrome (Playwright `chrome` channel), no longer bundled Chromium. Remote targets are not implemented yet (#226, #228).

**Breaking: the Playwright runner offers only Chromium unless told otherwise (ADR 0007, decision 1; #225).** The runner's `browser` and `supportedBrowsers` options are replaced by `browsers`, and `CaptureRunnerMetadata.supportedBrowsers` by `targets`. A server whose projects use Firefox or WebKit must list them (`browsers: ["chromium", "firefox", "webkit"]`) and provision the binaries (`playwright install`); until then the System page shows them as unavailable and their builds fail with that reason.

**Added: the public origin is resolved, not guessed (ADR 0007, decision 6; #227).** One resolver (`createPublicOriginResolver`, `@storyshelf/core/models`) answers every absolute link built in the background: `publicBaseUrl`, then the platform's own address (`detectPublicBaseUrl(env)`, `@storyshelf/core/utils`: Heroku, Railway, Vercel, Netlify, Render, Fly.io, Azure App Service and Container Apps, DigitalOcean), then the origin a site admin's browser reported, kept in the new `site_settings` table (`siteSettings` in `Tables`; DDL and Drizzle schema in the SQLite, Postgres and MySQL packages). **System → Public origin** shows what resolves, lets an admin confirm, replace or forget the stored value (`POST /admin/public-origin`, `/clear`, and `/report` for the page's own script; site-admin and CSRF protected, and the report must carry the browser's own `Origin`). Commit-status links and the pull-request comment use it, and are omitted while no origin is known (`target_url` is not sent); notification review links and the OAuth callback and `/.well-known/openid-configuration` helper use it too. The `Host` header is never used for background links.

**Added: build state on git channels is a function of the build, delivered by durable `notify` jobs (ADR 0014, decisions 5 to 7; #221, #222).** One pure function, `statusesForBuild` (`@storyshelf/core/adapter/notifier`), maps a build, the channel's prefix and the `testing`/review flags to the states a git channel shows: `<prefix>/testing` (`pending` while capture runs and review is open, `success` when approved, `failure` when rejected or capture failed, the description saying whether review is open), `<prefix>/storybook` for every build with a commit (informational: `success` linking the published Storybook once its manifest exists, `failure` for a failed build that never published) and one pull-request comment per build with links to the build and the Storybook plus a summary. `<prefix>/review` is in the function for the review setting to feed (`flags.review`). A build that was never captured posts its statuses (a hosting-only instance posts `<prefix>/storybook` when publishing ends), and links are absolute from `publicBaseUrl`. Every transition (build creation, capture start and end, crash failure, review outcome) and the end of publishing call one publisher (`BuildStatePublisher.request(buildId)`), which queues a `notify` job per git channel on the database queue: the job names a channel and a build, reads the build when it runs (a retried or reordered job cannot post a stale state), is folded into a job already waiting for the same pair, and is retried with backoff (five attempts: 10 s, 20 s, 40 s, 80 s). A given-up delivery records the error on the channel and raises the new `sys:notify-failed` admin event. `notify` jobs run on a queue and consumer of their own (four at once), so a status never waits behind a capture, and stay out of the queue views. A host with no queue consumer (serverless) delivers inline without durability. `postStatusesForBuild`, `emitBuildState`, `statusContext` and the app's `postReviewStatus` are removed; `DispatchDeps` carries `buildState` instead of `notifiers` and `secret`. `QueueJobInput.maxAttempts` and `KindHandler.backoff` let a job kind state its own attempts and retry delay.

**Breaking: git hosts are notification channels; `@storyshelf/git-github` and `@storyshelf/git-gitlab` are replaced by `@storyshelf/notify-git` (ADR 0014; #220, #223).** The notifier contract has two delivery kinds: `message` providers (Slack, Teams, email) `send` once, `state` providers (GitHub, GitLab, and a `git-log` provider for tests and dev) `setState` a commit status or a pull-request comment, idempotently. `ShelfOptions.gitHosts`, `GitHostProvider`, `GitHostAdapter`, the `@storyshelf/core/adapter/git-host*` subpaths and the `git-host` adapter category are gone: list `gitNotifiers` from `@storyshelf/notify-git` in `notifications.notifiers`. The `project_status_configs` table, `StatusConfigModel` and the `/api/v1/projects/{slug}/status-configs` routes are deleted with no copy of existing rows: configure each project again as a git channel (`notification_channels`: config `{ owner, repo, host?, prefix? }`, the token as the encrypted secret) on the project's Notifications settings page, which now manages chat, email and git channels together (the separate "Git status" tab is gone). Statuses are named `<prefix>/testing` (prefix defaults to `storyshelf`, no project slug and no second `storyshelf/` added by the provider), so update required statuses in branch protection and give each project that shares a repository its own prefix. `notification_channels` gains `last_error` and `last_error_at`: a failed delivery is shown on the settings page and in the channel API, and cleared by the next success (new columns reach existing Postgres and MySQL databases only when recreated). `isMerged` is dropped: a build of a commit that is already merged is captured like any other. Message fan-out never sends to `state` channels.

**Breaking: `@storyshelf/worker` and `@storyshelf/queue-sqs`, `-redis`, `-azure` and `-gcp` are removed (ADR 0006, decisions 5 and 6; #218, #219).** The app is the consumer, so there is no separate worker to deploy and no remote queue to provision; `CaptureQueue`, `PollableCaptureQueue`, the contract suite and the `testing.queue` override stay in core. The CLI loses the `worker init` and `worker serve` commands and the queue and worker questions of `server init`; the scaffold is one server with the database queue, and the AWS, Azure and GCP Terraform stacks drop the queue resources and the worker service (the app service gets browser-sized resources). The live-cloud workflows drop their queue legs. The website's capture, deployment and configuration pages describe `testing`, hosting only and the database queue, and carry the long-running-server requirement.

**Breaking: the app consumes the database queue; the in-memory capture queue, the boot sweep and the stall handler are gone (ADR 0006, decisions 4 and 5; #217).** `createShelfApp` wires ONE database queue (`capture_jobs`) and ONE consumer for every job kind (`capture` with `testing`, `publish` on a long-running host). Uploads enqueue onto it and the instance's consumer wakes at once; every instance with `testing` consumes. `InMemoryCaptureQueue`, `recoverStuckCaptures`, `recoverStalledCapture` (`INTERRUPTED_ERROR`, `STALLED_ERROR`), the app's stalled-capture handler and the boot requeue of `capturing` builds are deleted without a replacement: lease expiry and redelivery recover work, so two instances can start without resetting each other's builds, and a job whose last attempt lost its lease fails its build (`DatabaseCaptureQueueOptions.onExhausted`). New `testing.retries` (default 2) is the one retry limit for failed attempts, lost leases and forked-child crashes; `testing.queue` is now a `PollableCaptureQueue` that replaces the database queue and, with a `runner`, is consumed in-process too. `capturesLocally` is replaced by the store's `capturesHere`.

**Breaking: forked capture is parent-push (ADR 0006, decision 5; #217).** The app consumes the queue and pushes each leased job to the `testing.workerEntry` child over IPC (`run`/`cancel` down, `progress`/`done`/`failed` up); the child never reads the queue and inserts shard jobs into the database queue itself. `ForkedCaptureQueue`, `IpcCaptureQueue` and the `poll`/`enqueue`/`ack`/`nack` messages are deleted; `createForkedCaptureHandler` and the new protocol replace them. The concurrency slots live in the parent, so `STORYSHELF_CAPTURE_CONCURRENCY` no longer reaches the child (`STORYSHELF_CAPTURE_RETRIES` does). `runCaptureChild` now lives in `core/src/capture/forked/child.ts` (same export).

**Added: `testing` gates the app; hosting-only mode (ADR 0006, decisions 1 and 3; #216).** The app store now carries a real `testing` flag (`options.testing` is set) instead of inferring it from the capture queue. Without it, every route the route table classifies `testing` answers `404` (`Testing is not enabled on this instance.`; JSON on `/api/v1`, text on pages) through the new `requireTesting` middleware, mounted ahead of the CSRF and rate-limit guards; `hosting`, `both` and `review` routes are untouched. The navigation drops the Jobs entry and the capture, tests, git status and AI settings tabs; the System page shows a hosting-only notice with the number of hidden snapshots; boot logs the mode (a warning with `hiddenSnapshots` when snapshots exist); `POST /api/v1/projects/:slug/builds` returns `testing`, and `storyshelf upload` prints that no checks will run and skips the affected-capture post when it is `false`. `testing` now needs `runner` or `queue` (`testing: {}` throws). New `assertServerless` (`@storyshelf/core/config`): a process with `testing.runner` throws on AWS Lambda, warns on Vercel and Netlify, and `STORYSHELF_ALLOW_SERVERLESS=1` overrides it; `isServerlessHost` moved to core. Database metadata gains `supportsTesting`; the Cloudflare D1 preset sets it to `false`, and `createShelfApp` refuses `testing.runner` on it. A remote-queue-only instance (`testing: { queue }` without `runner`) is exempt from both checks. New concept page "Hosting only".

**Added: the Storybook catalog, and library, component and build pages that render from it (ADR 0006, decision 9; #215).** When publishing ends, the build's `index.json` is read into a compact `catalog.json` (next to the build's files) and one `build_components` row per component (project, build, story file, title, story count, hash; new table in all three database packages, purged with the build). A build published before the catalog existed is catalogued on first view. The library shows the components of the latest build of the selected branch whatever its status; the component page gains a **Stories** tab (a click-to-load preview, sandboxed with `allow-scripts` only, and every story and docs entry) and a catalog **History** (added, removed, renamed); the build page shows component and story counts and labels an accepted build with no attempts **Published**. All of it works without `testing`; with it the pages gain thumbnails, statuses, States, design and linked packages, and snapshot sections. Published Storybook files answer `Access-Control-Allow-Origin: *` for builds viewable without credentials (public builds, instances without sign-in) so the sandboxed frame can load; private builds under sign-in are not embedded. Upstream links fall back to the catalog when a build has no snapshots.

**Added: publishing independent of capture (ADR 0006, decision 10; #213).** An instance without `testing` now
publishes Storybooks of any size. A zip up to `maxInlineUnzipSize` (now defaulting to 50 MB, counted while the
upload streams instead of read from `Content-Length`) is extracted inline; a larger zip becomes a `publish` job
on the database queue, run by a consumer that every instance with a database starts at `lifecycle.setup()` and
drains at `teardown()` (capture shares the queue since #217). The file-by-file route (`/dedup`, `/content`, `/manifest`)
completes publishing when the manifest is stored. On serverless hosts (`AWS_LAMBDA_FUNCTION_NAME`, `VERCEL`,
`NETLIFY`) no consumer runs, and an over-limit zip is refused with `413` pointing to the file-by-file route;
`storyshelf upload` now falls back to that route by itself (the old `tryDedupUpload` stub is gone).
Extraction is capped by the new `maxZipEntries` (default 50 000) and `maxUnzippedBytes` (default 2 GiB), counted
while streaming, and refuses absolute and `..` paths; `maxInlineUnzipSize: 0` sends every zip to a job. When
publishing ends with no capture to run, a published build on the project's default branch becomes `approved`, a
failed publish makes it `failed`, and other branches stay `pending`; no approval event or webhook fires. With
`testing` on, capture still sets the status. `config.scratchDir` now always defaults to
`<os.tmpdir()>/storyshelf`. `PublishCompleter` runs `afterPublish` hooks for the catalog. The one-time boot task
that would re-process builds already `pending` is dropped (no data migrations): such builds stay as they are.

**Added: `createDatabaseCaptureQueue` (`@storyshelf/core/capture`), a database queue on the new `capture_jobs` table (ADR 0006); additive, not wired in yet (adapters gain `tables.captureJobs`; `LeaseRenewal` gains `"cancelled"`; queues may add `cancel`/`inspect`).**

**Added: `createCaptureConsumer` (`@storyshelf/core/capture`), the consumer loop for any pollable queue (handler per job kind, slots before polling, retries with backoff, lease by progress, cancel, drain on stop; optional metrics hooks). `runCaptureChild` moves into core and `@storyshelf/worker` re-exports it. Retention purge also drops finished `capture_jobs` rows and a removed build's job rows. Not wired into the app yet.**

**Breaking: `ShelfOptions.capture` is now `ShelfOptions.testing` (ADR 0006).** The option, its type
(`ShelfCaptureOptions` is now `ShelfTestingOptions`) and its error messages are renamed, and the
top-level `compare` and `images` options nest under it, so the shape is `testing: { runner, queue?,
concurrency?, workerEntry?, shardSize?, mode?, compare?, images? }`. `config.scratchDir` stays where
it is. There is no alias or boot-time error for the old keys: rename them in your server, and
`storyshelf server init` now emits `testing: { ... }`. Behaviour is unchanged; `runner` stays
optional for now. Separately, `packages/app/src/routes/classification.ts` now classifies every
registered route as `hosting`, `testing`, `review` or `both`, and a test fails on any unclassified
or stale route (classification only, nothing is gated yet).

**Changed: accessibility checks are on by default and visible in review (ADR 0004 §6).** `runA11y`
now defaults to on for new projects (no migration: an existing database keeps the stored value) and
a project admin can turn it off in Settings > Tests or with `runA11y` on the project API (create,
read, PATCH, OpenAPI). The axe findings are no longer only in the runner log: each capture's
violation lines are stored on its snapshot (`snapshots.a11y_violations`, JSON array, new nullable
column in the DDL; exposed as `a11yViolations` in the snapshot API) and shown on the snapshot review
page, in the filmstrip and on the component page. They still never block a build or change a
status. The default rule set is now the WCAG A/AA tags plus axe's `best-practice` tag (an explicit
`parameters.a11y.options.runOnly` still replaces it); the page-level best-practice rules do not fire
for the default `#storybook-root` scan, so no rule is disabled. The MCP server and the CLI do not
mirror other project settings and do not expose it. Fixtures gained a `BestPractice` story.
**Added: axe-core accessibility checks (ADR 0004 §6).** With `runA11y` on, the Playwright and
Puppeteer runners now run axe-core over `#storybook-root` before the screenshot instead of the old
hand-rolled DOM scan (removed, with no fallback). Each violation is one `a11y:` annotation with the
rule id, impact, help text, a short selector and the node count (at most 10, then `…and N more`).
Stories' `parameters.a11y` is honoured (`disable`, `test: "off"`, `config`, `options`,
`element`/`context`; JSON-serialisable values only). If axe cannot run, the story gets one
`axe unavailable` annotation. Results stay non-blocking and never fail a build. `axe-core` (pinned)
is a dependency of `@storyshelf/core` only; the runners reuse it through `@storyshelf/core/capture`.
The fixtures gained `Components/Accessibility` stories and the Puppeteer runner a gated axe test.
**Fixed: environment migrations and the screenshot sweep (ADR 0031 phase 4).** A feature-branch
build no longer auto-accepts snapshots whose capture environment differs from the baseline's: it
diffs them, and a difference is `changed` with the environment change shown on the review page.
The default branch still migrates without a diff. Fingerprint components a capture did not report
(screenshots spooled before a browser crash, a failed `fc-list`) are unknown rather than changed
and never overwrite the baseline's, and a viewport size change diffs instead of migrating. The
screenshot sweep defers deletions while a build of the project is still capturing or a baseline
import or approval holds a reuse claim, so it can no longer delete an object a capture has just
reused. Local storage writes are atomic (temp file + rename) and `list()` returns `/`-separated
keys on every host. `sweepScreenshotContent` now needs `tables.builds`.

**New: `@storyshelf/image` and an opt-in `sharp` image engine (ADR 0032).** The pixel diff, its
worker pool, overlay rendering and AI thumbnails moved into the new leaf package
`@storyshelf/image` (`@storyshelf/core/diff` re-exports it). `pixelmatch` stays the comparator;
the PNG codec is selectable: `createShelfApp({ images: { engine: "sharp" } })` or
`STORYSHELF_IMAGE_ENGINE=sharp` (the option wins), with `pngjs` the zero-dependency default.
`sharp` is an optional peer: install it yourself, and startup fails clearly when it is missing.
Remote workers take the same `images`/`compare` options on `createCaptureWorker`, and forked
capture children inherit them from the server. See the "Image engines" guide.

**Upgrading (image engine):**

- `diffImages` and `buildTriageEvidence` now return Promises (the `sharp` codec is async): `await`
  them. Code that read `diffImages(...).passed` synchronously now reads `undefined`.
- `configureDiffPool({ threads })` is deprecated in favour of `configureImages({ engine, threads })`;
  the old name still works.

**Breaking: Figma is now a design-provider adapter.** Figma support moved out of core into
the optional `@storyshelf/design-figma` package behind a new `DesignProvider` adapter
(ADR 0029).

**Upgrading:**

- Install `@storyshelf/design-figma` and pass `design: [createFigmaDesign()]` to
  `createShelfApp` — and to `createCaptureWorker` on remote workers. Without a provider no
  design links are extracted or shown. `storyshelf server init` asks about it; the dev server and
  Fly demo are wired.
- Re-enter the Figma access token once under **Settings → Design** (credentials moved to a
  new `design_credentials` table). The old `figma_nodes` / `design_tokens` tables are dropped on
  startup; the metadata/render cache simply refetches.
- The component page's Figma tab is now `?tab=design`.

**Connect your own account:** when a project has no design token, signed-in members can connect
their own Figma account for previews (ADR 0030). Set `FIGMA_CLIENT_ID` / `FIGMA_CLIENT_SECRET`
(a Figma OAuth app with redirect `<publicBaseUrl>/connections/figma/callback`, scope
`file_content:read`; needs auth enabled and `config.secret`) and pass
`createFigmaDesign({ oauth: figmaOAuthFromEnv() })`. The flow, token storage
(`user_connections`) and refresh are service-neutral (`@storyshelf/core/adapter/oauth`), so other
adapters can offer it too. A project token still takes precedence; a member's token is used
only on their own visits, and what it fetches is shown only to them.

**Added:** `@storyshelf/core/adapter/design` (`DesignProvider`, `DesignClient`,
`parseDesignUrl`), `designContractSuite` in `@storyshelf/core/test-helpers`, and a per-viewer
cache scope (`design_nodes.viewer_id`).

**Fixes**

- The Puppeteer runner now runs `play` functions on Storybook 8, 9 and 10 (it failed with `Cannot call fromId/raw() unless you call cacheAllCSFFiles() first`), by loading just the story and running its `playFunction` with the mounted render's context, as the Playwright runner already does.

**Attempt logs**

- The build attempt log no longer stops at "partitioned" during a render. Per browser engine it now records the partition counts, the runner's `info`/`warn`/`error` lines (`capture sizing`, `browser recycled`, `render failed for story`, a11y warnings; debug stays out), `captured N/M screenshots` every 10 screenshots, and a `render pass finished` summary. Lines are written serially so order and sequence numbers stay correct under parallel rendering.

**Streaming and page reuse**

- Screenshots are written to storage as each is captured (new optional `onCapture` on `CaptureRunner.render`; both bundled runners support it), so memory no longer grows with the number of stories. Runners that ignore it keep working unchanged.
- Opt-in page reuse (`reusePages` / `STORYSHELF_REUSE_PAGES=1`) for both runners: pooled pages in their own contexts, reset between captures, discarded after a failure. Screenshots were byte-identical with reuse on and off on the bundled fixtures.

**Capture memory**

- Capture no longer opens a browser page for every story and viewport at once, which ran 500-story Storybooks out of memory on 1 GB hosts. Pages render with bounded concurrency, and snapshot persisting is capped at 4 at a time.
- Capture concurrency defaults are sized from the CPU and memory the process can use, container limits included (0.5 vCPU / 1 GB renders one page at a time; `ShelfConfig.captureConcurrency` defaults to 1 build unless the host has ≥ 2 CPUs and ≥ 3 GB). Override with `concurrency` on `createPlaywrightCaptureRunner` or `STORYSHELF_CAPTURE_CONCURRENCY`.
- Page navigation timeout scales up on CPU-starved hosts (60 s under 2 CPUs, 90 s under 1 CPU; override with `navigationTimeoutMs` or `STORYSHELF_NAVIGATION_TIMEOUT_MS`), so slow Storybook loads are not reported as failures.
- Chromium launches with low-memory flags (`--disable-dev-shm-usage`, `--disable-extensions`, `--disable-background-networking`, `--mute-audio`) to avoid crashes on small container `/dev/shm`.
- `@storyshelf/worker` sizes `concurrency` from the host the same way (1 capture, or 2 with ≥ 2 CPUs and ≥ 3 GB) instead of a fixed 2, and `DEFAULT_WORKER_CONFIG` no longer carries `concurrency`. Scaffolded workers pass `WORKER_CONCURRENCY` only when set.
- The per-render time budget scales with the number of captures (15 minutes minimum, 15 seconds per capture), so slower one-page-at-a-time captures on small hosts are not cancelled as timed out. An explicit `renderTimeoutMs` is unchanged.
- Both runners restart the browser every 150 captures (`recycleBrowserEvery` / `STORYSHELF_BROWSER_RECYCLE_EVERY`, `0` disables) and log a `capture sizing` line with the detected CPUs, memory and resulting settings at the start of each render.
- The Puppeteer runner gets the same bounded concurrency, automatic sizing, timeout scaling and low-memory launch args as the Playwright runner.
- Storing a build's Storybook statics now reads, hashes and uploads files with at most 8 in flight instead of reading every file into memory at once.
- The Fly demo app uses the automatic sizing (optional `CAPTURE_CONCURRENCY` override) and caps the Node heap with `NODE_OPTIONS` in `fly.toml`.

## 0.6.2 — Lean scaffold, working Docker images, Node 24 (2026-10-08)

A fix-focused release. `storyshelf server init` now generates a smaller
`src/`-based project with a `tsconfig.json`, and its Docker images actually
start; `npx storyshelf` starts faster and reports the right version; and a
server that opts out of auth no longer fails to bundle.

**Upgrading:** Node 24 is now the minimum supported version (every package
declares `engines.node >=24`, and generated projects require it). Existing
scaffolded projects keep working and are not rewritten; regenerate to get the
new layout and fixed Dockerfiles.

**CLI startup**

- Command modules and their dependencies (the zip library, prompts) now load only
  when that command runs, so `storyshelf -h`, `whoami` and the rest start in
  about 10 ms over bare Node instead of about 55 ms.
- `storyshelf --version` reports the real package version (it was hardcoded to
  `0.2.0`).
- Dropped the unused `hono` dependency from the CLI, so `npx storyshelf`
  installs less.

**Node 24 is the minimum**

- Every published package declares `engines.node >=24` (none did before), the
  release check fails if one does not, and the docs, README and CI example now
  say Node 24 instead of 22 or 20.
- The slim server image is pinned to `node:24-alpine` instead of the floating
  `node:lts-alpine`.

**First-run and release safety**

- `@storyshelf/db-sqlite` creates the database file's directory (all file-based
  presets), so a fresh scaffold or an empty Docker volume boots instead of
  failing with `unable to open database file`.
- CI now smoke-tests the built artifacts: the CLI launched through a `.bin`
  symlink (as `npx` does), and a freshly scaffolded server that type-checks,
  boots, serves HTML and vendored assets, and shuts down cleanly. The two
  regressions that shipped in 0.6.0 and 0.6.1 would have failed it.
- Generated projects (`npm start`, `dev`, `worker`, the Docker `CMD`) and
  `storyshelf server serve` / `worker serve` no longer pass
  `--experimental-transform-types`, which Node 26 rejects (`bad option`). Node 24
  and later strip types without a flag, so entries run with plain `node`; the
  generated `package.json` declares `engines.node >= 24`.
- The npm publish job skips versions that are already published, so a partly
  failed release can be re-run (the JSR job already did this).

**CI**

- The whole pipeline now runs on Node 24, the minimum supported version
  (`devEngines.runtime` is `24.x`; it was `>=24`, which CI resolved to the
  newest Node). The smoke test asserts the Node major so the default cannot
  drift unnoticed.
- The website build, link check and accessibility check run only when
  `apps/website/` changed (scheduled and manual runs always run everything).

**`storyshelf server init` scaffold**

- Entry code now lives in `src/index.ts` (and `src/worker.ts`) so you can split
  logic into more files; `tsconfig.json`, `@types/node` and a `typecheck` script
  are generated so the editor resolves types. `storyshelf server serve` /
  `worker serve` find `src/` first and still run the older root layout.
- Leaner output: notifications and OpenTelemetry wiring are opt-in (the prompts
  now default to no), imports from the same module are merged, and unused
  variables and dependencies are no longer emitted.
- Docker: `compose.yaml` is only generated when the stack has more than one
  service (Postgres or a worker); a single container gets `docker:build` and
  `docker:run` scripts instead.
- Fixes: the generated Docker images could not run. They bundled the server
  with esbuild into one ESM file, which crashes at startup (`Dynamic require of
"util" is not supported` from a CommonJS dependency) and cannot find the
  vendored assets `@storyshelf/app` reads from disk; the `CMD` also pointed at
  a path the bundle was never copied to, and the build copied a `playwright`
  package that is never installed. Images now install production dependencies
  and run `src/index.ts` directly with Node (as `npm start` does), on a
  Playwright image pinned to the `playwright-core` version. With a worker, the
  compose worker service was written inside the `volumes:` block (invalid) and
  had no `DATABASE_URL`.
- **Heads-up:** the generated server file moved from `server.ts` to
  `src/index.ts`; existing projects keep working and are not rewritten.

**Packaging**

- `@storyshelf/app` no longer imports `@storyshelf/auth`, so a server that opted
  out of auth bundles and installs without it (it failed to resolve before). The
  shared `Auth` contract plus `MIN_PASSWORD_LENGTH` and `unsignedToken` come
  from `@storyshelf/core/auth`; `@storyshelf/auth` re-exports them.

**Server runtime**

- `@storyshelf/runner-playwright` loads `playwright-core` on the first render
  instead of at import, taking ~220 ms of CPU and tens of MB off server boot
  (and off servers that hand renders to a remote worker).
- Shutdown waits (up to 5 s) for the stuck-capture recovery and credential check
  that run after setup, so an early SIGTERM no longer logs `database is not open`.

## 0.6.1 — CLI and auth fixes (2026-10-06)

- **CLI:** `npx storyshelf` (and any bin launched through a `.bin` symlink) now
  runs; it exited silently with no output because the entrypoint check did not
  resolve symlinks.
- **Auth:** the env-driven admin login works with a valid default email.

## 0.6.0 — Better Auth, notifications, affected capture, UI redesign (2026-10-06)

The first release where **all 24 packages are published to both npm and JSR**,
with provenance, from CI. Highlights since 0.5.x: the Better Auth engine,
notifications, affected capture, OpenTelemetry observability, the redesigned UI,
and the sqlite/postgres/mysql adapter preset families.

**Affected capture** (`@storyshelf/affected`)

- New package: git diff + Storybook stats-graph tracing (with `untraced`
  globs) selects the stories a change can reach. The capture pipeline renders
  only those and **inherits the rest unchanged from baselines**; new stories
  always render.
- The server records the affected computation per build and returns
  `baselineSha`; the UI shows affected/full badges and inherited snapshots; the
  CLI prints an affected summary (`--full` opts out) and `doctor` checks
  readiness. Checkouts without git get an auto-generated local identity.
- **Breaking (days-old key):** `affected.untraced` is now the top-level
  `untraced` in `storyshelf.json`. `storyshelf init` stamps a `$schema` for
  editor completion.

**Auth engine: Better Auth** (ADR 0023)

- `@storyshelf/auth` is now a Better Auth engine: password + OIDC presets,
  invite-only local accounts, profile and sessions, passkeys, SAML/SSO, and
  IdP group sync. Config-as-code, boot validation and mode logging.
- The shared-password tiers are gone; use local accounts or an IdP.
- Composite multi-auth with per-provider state, customisable login UI via
  `UIConfig.auth`, public relying-party discovery and change-password
  well-known routes, and a personal profile page with a display-name override.

**Notifications** (ADR 0024)

- New notifier adapter family: `@storyshelf/notify-chat` (Slack, Teams, log)
  and `@storyshelf/notify-email` (SMTP, Mailpit, HTTP, log; `nodemailer` is an
  optional peer). Per-provider subpaths keep installs small.
- Channels and per-user subscriptions (new `notification_channels` and
  `notification_subscriptions` tables), fan-out for builds, comments and purge,
  reset emails, and `sys:*` admin alerts. Settings and profile UI included.
- **Action required after upgrade:** run DB migrations for the new tables.

**Database presets**

- `@storyshelf/db-turso` is folded into `@storyshelf/db-sqlite` (deprecated):
  presets `turso`, `better-sqlite3`, `bun-sqlite`, `d1`.
- Postgres presets (`pg`, `neon`, `neon-http`, `vercel`, `pglite`) and MySQL
  presets (`mysql2` default, `planetscale`, `tidb`, new `@storyshelf/db-mysql`),
  with shared schema/DDL. All 14 choices appear in `server init`.
- The core DB contract moved to `@storyshelf/core/adapter/database`.
  `@libsql/client` 0.18; Node >= 24 is now accepted.

**Storage and capture**

- Content-hash dedup of Storybook assets (`content/<hash>` + per-build
  manifest, `content_refs` table, 7-day GC grace), with `dedup`/`content`/
  `manifest` API endpoints. **Action required:** run DB migrations.
- Builds interrupted by a restart are requeued once, then failed. Per-story
  `diffThreshold` is honoured. The orchestrator enforces a render timeout and
  caps per-failure error text. PNG magic and a 25 MiB cap are checked before
  storage writes. Workers back off when polling queues that do not long-poll.
- Fixes: Storybook link resolution, default-branch approval, baseline-change
  handling, the in-page a11y check, and a non-unique builds `(project, sha)`
  index.

**Operations**

- Site-admin **System** page with adapter inventory, live health and safe
  server config; boot-time validation of adapter implementations fails fast.
- Server secret rotation for encrypted credentials (#107).
- Opt-in `Server-Timing` headers (`serverTiming`) and per-phase capture timings.
- Library is the default project landing page, with "View Storybook" short
  links (`/_/<slug>` or `/_/<buildId>`) across projects, library and builds.
- Adapter errors, health and the merge gate redact secrets.

**Publishing and packaging**

- Every package is published to npm (trusted publishing + provenance) and JSR
  from `release.yml`. The JSR job skips versions that already exist, so it is
  safe to re-run.
- New subpaths `@storyshelf/core/orm`, `/orm/pg-core` and `/orm/sqlite-core`
  re-export Drizzle. `@storyshelf/core` is the single owner of `drizzle-orm`;
  `auth` and `app` no longer declare it.
- New first-time publishes: `affected`, `app`, `auth`, `db-mysql`,
  `db-postgres`, `notify-chat`, `notify-email`, `observability`, `queue-azure`,
  `queue-gcp`, `queue-redis`, `runner-puppeteer`, `storage-azure`,
  `storage-gcs`, `worker` (npm). LICENSE and README added where missing.

**Brand mark: logo, favicon and social assets**

- New StoryShelf mark (a bookshelf whose three shelves and books form an `S`).
  Ships as `app/src/assets/mark.svg`, served content-hashed under `/assets/`.
- The app now **always** links its own favicon so a StoryShelf tab is
  recognisable. `UIConfig.favicon` is **deprecated and ignored** (still accepted
  by the schema so existing configs keep validating); `SS_FAVICON_URL` is no
  longer read by the dev-server or Fly app. Rebranding uses `ui.logo`, which
  stays overridable and now defaults to the mark instead of a generic icon.
- Website ships the full icon set: `favicon.svg`, `favicon.ico`, 16/32px PNGs,
  a 180px apple-touch-icon, a Starlight header logo, and a redesigned
  1200x630 `og-image.png` (previously a cropped screenshot).

**Review page: draggable wipe handle and pixel-level zoom** (#40)

- The Swipe comparison now has a draggable handle on the divider (mouse, touch and pen); the slider below stays as the keyboard/screen-reader control and stays in sync.
- Zoom gains a 400% level, and zoomed-in screenshots render with `image-rendering: pixelated` so individual pixels are visible. `+`/`-` step the zoom; `f` still cycles.

**UI redesign: shell, review workspace, icon sprite** (ADR 0025)

- New app shell: full-height icon sidebar (collapsible rail, mobile drawer),
  slim neutral top bar with project switcher, theme menu, account menu and
  toasts. The customer accent now tints (brand mark, active nav, primary
  actions, derived `color-mix` washes) instead of flooding the top bar;
  `BrandTheme.topbarBg` is deprecated (still accepted, ignored). Default
  text colors now meet WCAG AA.
- Review page is a workspace: thumbnail filmstrip with filters, review
  progress, side-by-side / swipe / onion-skin / diff / flip comparison with
  zoom and synced scroll, a sticky action bar, a `?` shortcuts dialog, and
  auto-advance to the next open snapshot after approve/reject (HTMX, review
  page only). Bulk approve/reject now ask for confirmation.
- The top bar is now a project picker plus breadcrumbs of the page's ancestors
  (`Builds › main · abc1234` on the review page; the current page is named by
  its heading, and phones show just `‹ Parent`); the account menu, theme menu and sidebar collapse moved to the
  sidebar footer. `PageHeader` no longer takes `breadcrumbs`; pages pass
  `nav.trail` instead.
- Projects overview cards (previews, "to review" pill, filter), builds list
  (status chips with counts, branch select, table), library story filter,
  settings sub-navigation, and a chrome-free sign-in/invite layout.
- Icons are served as one SVG sprite at a content-hashed, immutable URL;
  htmx moves to a content-hashed URL too (the unversioned URL stays but now
  revalidates instead of being cached for a year).
- Forms: refreshed field styling and focus states, pending spinner on submit,
  confirmations on destructive actions, and success toasts after settings,
  project, profile, token, webhook, member and comment actions (server-set
  flash cookie). Validation errors now actually show: HTMX ignored the 400
  pages, and the tokens/labels/members/status tabs never rendered
  `globalError`. Comment forms no longer swap raw JSON into the page.
- Fixes: review keyboard shortcuts no longer fire on Cmd/Ctrl+R; the
  diff view switch matched a renamed class; document-level listeners were
  re-registered on every HTMX body swap.

**Observability: OpenTelemetry tracing, metrics, log correlation**

- New `@storyshelf/observability` package (single owner of all OTEL deps):
  env-driven SDK init (`initObservabilityFromEnv`, noop without
  `OTEL_EXPORTER_OTLP_ENDPOINT`), `@hono/otel` request spans with
  `storyshelf.req_id`/`enduser.id`, `db.*`/`storage.*` adapter wrappers,
  capture metrics, W3C queue propagation, and a pino `trace_id`/`span_id`
  mixin. Logs stay on stdout by design.
- Core emits `http.client` and `capture.job` (+ extract/render/persist
  phase) spans via `@opentelemetry/api`; queue payloads carry an optional
  `traceparent` so remote workers continue the uploading request's trace.
  `createShelfApp` mounts the middleware, serves instrumented adapters, and
  flushes the SDK on teardown (new structural `ShelfOptions.observability`).
- `storyshelf server init` (and worker) scaffolds include the wiring
  preamble; `createShelfLogger` accepts a `mixin`. See
  `docs/observability.md` and ADR 0022. No endpoint ⇒ behavior unchanged.
  The word `telemetry` is reserved for a future opt-in usage-reporting
  feature — this package never sends data to StoryShelf.

**Auth: admin-token bootstrap, user-bound tokens**

- New `ShelfConfig.adminToken` (`STORYSHELF_ADMIN_TOKEN`/`ADMIN_TOKEN` env):
  bearer grants site-admin API access before any user exists. Distinct from
  `secret` (session signing); never mints sessions.
- API tokens are bound to their creating user (`tokens.user_id`) and resolve
  to that user's live project role; bearer callers are now subject to route
  role requirements. Legacy ownerless tokens resolve as viewer; tokens whose
  owner is deleted are denied. Re-issue CI tokens that approve or manage.
- Project creation records the session creator as project admin.
- **Action required after upgrade:** re-create CI tokens used for
  approve/reject/manage flows; run DB migrations for the new `user_id` column.

**Auth: site-viewer auditor, OIDC team sync**

- New site `viewer` role: read-only visibility into all projects without
  membership; explicit membership takes precedence. Request logs carry the
  user id on request end for read attribution.
- OIDC adapter generalizes endpoints via Discovery (Keycloak layout fallback),
  extracts group memberships from configurable claims, and ships Keycloak,
  Okta, Entra ID, Cognito, and Auth0 presets. `adminGroups`/`viewerGroups`
  map groups to site roles (exact match); Entra group overage fails closed.
- New `project_group_mappings` table maps IdP groups to project roles per
  project (API + Members settings tab); login syncs memberships (highest role
  wins, removals revoke synced grants only, manual grants untouched).
- **Action required after upgrade:** run DB migrations for `project_members.source`
  and the new `project_group_mappings` table.

**New adapters**

- `@storyshelf/queue-redis` — Redis-backed remote capture queue (`ioredis`).
- `@storyshelf/storage-azure` — Azure Blob Storage adapter.
- `@storyshelf/storage-gcs` — Google Cloud Storage adapter.

**Adapter lifecycle**

- `AdapterLifecycle` is now mandatory and all-or-nothing: every adapter
  implements `setup`/`teardown`/`health`. Storage `health` results no longer
  report `latencyMs` (they return `{ ok }`).

**JSR**

- `@storyshelf/app` ships the `hono/jsx` import map so JSX rendering resolves on
  deno/JSR consumers.

## 0.5.5 — Publish pipeline fixes (2026-10-06)

- `@storyshelf/core/orm` subpaths; `auth` and `app` drop their own
  `drizzle-orm` dependency (fixes the JSR resolution failure for `app`).
- The JSR publish job skips versions already on JSR.

## 0.5.4 — First CI release with provenance (2026-10-06)

- First release published by `release.yml` with npm trusted publishing: all
  24 packages with provenance. JSR stopped at `@storyshelf/app` (undeclared
  `drizzle-orm`); fixed in 0.5.5.
- `scripts/npm-trust-all.mjs` is idempotent and verifies state.

## 0.5.3 — All packages on npm and JSR (2026-10-06)

- Every package published to npm for the first time (published locally,
  without provenance); JSR packages created and linked to the repo.
- `@storyshelf/affected` gets a build config so its `deno.json` is generated;
  LICENSE and README added to the packages that lacked them.

## 0.5.2 — Docs, screenshots, cloud targets (2026-09-23)

**Cloud deploy targets**

- `storyshelf server init` gained AWS, Azure, and GCP Terraform reference stacks.
- New adapters: `@storyshelf/storage-azure`, `@storyshelf/storage-gcs`,
  `@storyshelf/queue-azure` (Storage Queues + Service Bus), plus GCP Pub/Sub.
- Opt-in live-cloud test suites and CI workflows for AWS, Azure, and GCP.

**Capture & UI**

- Per-project capture browser switch; selectable Playwright or Puppeteer runner.
- Per-story viewports from the Storybook viewport config; runtime preview
  fallback for story parameters; `waitForReady` hook honoured.
- Per-attempt build log history with retry support; host-owned runtime loggers
  via `Adapter.setLogger`.
- New library gallery with branch picker and per-story deep links.
- Refreshed UI theme; stylesheet served unescaped so fonts and selectors survive.

**Auth**

- Tiered shared passwords (admin/viewer) for the demo deployment.

**Docs**

- Core concepts section, grouped guides, Chromatic comparison and migration
  guides, screenshots across the site, `storyshelf.js.org` as canonical domain.

## 0.5.1 — Pre-launch UX polish (2026-09-15)

- Fixes from the pre-launch UX audit; clearer sidebar Developer section.
- Publish fixes: real semver for `catalog:` specs, bundled `LICENSE` for JSR.

## 0.5.0 — Rename to `app`, per-project browsers (2026-09-06)

**Breaking rename**

- `@storyshelf/router` → `@storyshelf/app`; `createShelfRouter` →
  `createShelfApp` (ADR 0018 was the split, this release makes the name
  permanent). Migrate imports and the `createShelfRouter(...)` call.
- The old `@storyshelf/router` name is deprecated on npm/JSR.

**Capture**

- Per-project browser and viewport configuration (`core`, `db`, `runner`).
- A11y annotation support, `staticServer` utils, and browsers metadata
  (`core`, `runner`).

## 0.4.0 — `db-postgres`, worker, HTTP helper (2026-09-06)

**New packages**

- `@storyshelf/db-postgres` — Postgres adapter for managed providers; the CLI
  gained `create server`/`init` support for a Postgres option with a local
  Docker Compose service.
- `@storyshelf/worker` — remote capture worker with SQS queue and hybrid CLI.

**Domain split (ADR 0018)**

- `@storyshelf/router` (the HTTP layer) is split out of `@storyshelf/core`;
  core stays domain-only. Renamed `app` in 0.5.0.
- Models are dialect-agnostic over the widened `DatabaseAdapter` (tables as
  interface); SQLite-specifics live in `db-sqlite`. Drizzle factories colocate
  under `core/src/db`.

**Retention & purging**

- TTL branch GC: daily sweep removes stale baselines; orphan baseline storage
  objects are deleted on GC.

**HTTP & logging**

- Shared `httpJson`/`HttpError` helper in `core` (timeout + retry with
  `Retry-After`); fetch-based git providers (ADR 0019).
- Single pino owner in core (`createShelfLogger`), env-driven level default
  (ADR 0014).

**CLI**

- New `build`, `doctor`, `whoami`, `upload --dry-run`, `server serve`,
  `jsr archive/unarchive` commands.
- Drops `zod` for hand-rolled config validation; publishes npm-clean on npm
  as bare `storyshelf` (and is no longer published to JSR under `@storyshelf/cli`).
- Detects the user's package runner for builds and scaffolding.

**Tooling & hygiene**

- oxfmt/oxlint pre-commit hooks with conventional-commit gate.
- LICENSE (MIT) + npm/JSR keywords on publishable packages; `primary export
first` lint enforced; dense router/core modules broken down into helpers.
- Topological publish order derived from manifests; GitHub Release split into
  its own job; OIDC check runs early.

## 0.3.2 — Release tooling & retention fix (2026-09-06)

- `latestPerBranch` retention query now uses the query builder and honors
  `orderBy` (fixes camelCase-column failure on real databases).
- Publish order derived topologically from manifests; validation gates once;
  npm/JSR publishers depend only on that gate (JSR failures never block npm).
- Release pipeline inline scripts extracted to `scripts/`; `check-npm-oidc`
  fails fast before install.

## 0.3.1 — Release fix (2026-09-06)

- Fix `ref_name` evaluation in the release workflow (double-brace expressions).

## 0.3.0 — Streaming uploads + webhook secrets (2026-09-06)

**Webhook secrets encrypted at rest (#45)**

- `webhooks.secret` (plaintext) is replaced by `secret_encrypted` (AES-256-GCM
  under `ShelfConfig.secret`). The legacy column is dropped by migration —
  pre-existing plaintext secrets are **discarded, not migrated**.
- **Action required after upgrade: re-create webhooks.** Until then, deliveries
  for old webhooks fail closed (skipped, never crash). Creation fails loudly
  when `SECRET` is unset.
- `WebhookModel` now takes the server secret (`new WebhookModel(db, secret)`);
  `DatabaseAdapter` no longer exposes top-level `migrate()`/`close()` (see
  #59 lifecycle); `emitWebhookEvent` takes the secret as its final argument.

**Streaming uploads replace multipart (#53)**

- `POST /api/v1/projects/:slug/builds` accepts only `application/json` and
  returns `{ build, uploadUrl }`; the bundle streams via
  `PUT …/builds/:buildId/zip` (new `StorageAdapter.writeStream/readStream`;
  `maxUploadBytes`, default 1 GiB, enforced with `413`). The multipart form
  route is removed — servers answer old CLI uploads with `4xx`.
- **Action required after upgrade: upgrade the CLI.** Old servers are not
  supported by the new CLI (no fallback); old CLIs cannot upload to new
  servers. The deprecated `--storybook-dir` alias is removed (use
  `--build-dir`); JSON creation accepts `labels: [{ key, value }]`, and the
  CLI gained repeatable `--label key=value`.
- Small zips persist Storybook statics inline at upload time.

**Adapters**

- Mandatory metadata category plus adapter lifecycle and two-tier health.

## 0.2.0 — Repository restructure (2026-09-05)

Internal reorganization with a small, documented public-surface cleanup. See
`docs/migration-0.2.md` for the import-path changes.

**Public surface (`@storyshelf/core`)**

- Barrel is router-only: `createShelfRouter` + option/config/app types. All
  values moved to subpaths (new entries: `core/logger`, `core/capture`,
  `core/adapter/capture-queue`, `core/paths`, `core/urls`, `core/diff`).
- Internal tooling (`store`, `middleware`, `retention`, pages) has no public
  entry and may change without notice.

**Core layout (`@storyshelf/core`)**

- `schema/` per-entity directory replaces `schema.ts` + `schema-tables.ts` (one module
  per entity, mirroring `models/`; DDL drift-guard test added).
- Barrel (`@storyshelf/core`) now also exports `models/*`, `middleware/*`, and the
  request `store`. Model modules no longer re-export row types.
- `index.tsx` (482→~250 lines): capture dispatch (`capture/dispatch.ts`),
  merge/dedupe skip checks (`capture/skip-checks.ts`), and middleware factories
  (`middleware/request-log.ts`, `store-scope.ts`, `auth-gate.ts`) extracted.
- Settings router split by tab area (`settings.handlers.ts` + `settings-*.ts`);
  `build-diff` page split into section components; `ui/components.tsx` is now a
  facade over `ui/{buttons,feedback,forms,layout}.tsx`.
- Test doubles moved to `test-helpers/` (never shipped); `status-fanout.test.ts`
  colocated with its implementation.

**Adapters**

- New `createDrizzleAdapter` factory (`core/adapter/database`); `db-sqlite` and
  `db-turso` are thin driver shims. Adapter tests gained exact type inference.
- `db-sqlite` runs on the `node:sqlite` builtin via `drizzle-orm/sqlite-proxy`
  — zero native dependencies (`better-sqlite3` removed). Same signature, same
  WAL mode, same schema.
- New shared `upsertReviewComment` flow (`core/adapter/git-host/comments`);
  `git-github` / `git-gitlab` comment modules are thin provider bindings.

**Apps**

- `dev-server` and `fly-app` stay separate launchers owning their own adapter
  wiring, so deployments can diverge (locals vs Turso/S3). Shared code lives in
  `packages/`, not `apps/` (a shared-assembly experiment was evaluated and
  reverted for exactly this reason). `apps/` packages are unversioned (the
  release script only versions `packages/`).

**CLI (`@storyshelf/cli`)**

- `create`/`init`/`upload` accept an optional `cwd` (test seam, backward compatible).
- Command test suite added (config, create, upload, init, retry, purge).
- All file-wide `oxlint-disable` headers removed (`index`, `config`, `create`,
  `init`, `upload` refactored into small helpers).

**Repo hygiene**

- `docs/repo-structure.md` added (annotated map; bundler rule: tsdown for libs,
  rolldown for apps); `AGENTS.md` / `README.md` drift fixed.
- `.oxlintrc.json`: deleted the `packages/core/src/**` wildcard and the hardcoded
  file list; legacy violations tracked per-file (see open issues) instead.
- `turbo.json` build outputs scoped to `dist/**`.

## 0.1.3 and earlier

See GitHub releases (`v0.1.x` tags) for the pre-restructure history.
