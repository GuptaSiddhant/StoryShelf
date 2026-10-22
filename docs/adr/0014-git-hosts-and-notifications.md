# ADR 0014: Git Hosts and Notifications

## Status

Accepted. Amended with the details of the statuses function and the `notify` job kind (decisions 5
and 7), recorded while implementing them (#221, #222).

Supersedes (archived): ADR 0010, ADR 0024, ADR 0036

## Context

Visual testing and review only pay off when they block bad merges. Teams want a pull request on
GitHub or GitLab to be unmergeable until its changes have been checked and approved in StoryShelf.
The simplest gate is a required commit status: StoryShelf posts a status on the head SHA, the
repository owner marks it required in branch protection (GitHub) or a merge rule (GitLab), and the
host blocks the merge until the status is `success`. That needs no OAuth App, only a token that can
write statuses.

Teams also want human notifications: formatted Slack or Teams messages and email, with
project-level channels owned by admins, per-user opt-ins, and site-wide admin alerts (new users,
failures, purge). Webhooks (`webhooks` table, signed JSON POST per project) are the machine
primitive; the consumer owns formatting.

Git statuses and chat or email messages are the same kind of work, outward integration triggered
by build changes, so they share one adapter family. They differ in one way that matters: a required
status is a merge gate, so a lost update leaves a pull request stuck or wrongly green, while a lost
chat message is merely missed.

## Decision

### 1. The merge gate is a required commit status

StoryShelf posts commit statuses on the build's commit SHA; the repository owner makes the gating
one required. Statuses are posted only for projects that configure a git channel; posting is an
explicit opt-in.

A git channel authenticates with its own per-project credential (a PAT or app installation token),
never the CLI project token: the project token identifies a build, the git credential authorizes
writes to the repository.

The merge gate is why `approver` and `developer` are distinct roles (ADR 0011 Authentication and
Access): developers push and re-run builds, but only approvers and admins accept snapshots or give a
build-level verdict, and a gating `success` requires that acceptance. "Who can green-light a merge"
is answered by role, not convention.

### 2. One notifier family with two delivery kinds

`core/adapter/notifier/*` defines the family. A `NotifierProvider` is a descriptor (`metadata
{ category: "notifier", kind, logo?, schema }` plus `create()`); `ShelfOptions.notifications.notifiers` lists the
implementations. An unknown `kind` on channel create is a 400. A provider declares how it delivers:

- **`message`** (Slack, Teams, email): `send` a formatted message once.
- **`state`** (GitHub, GitLab): `setState` of a named thing, idempotent, latest call wins: a commit
  status for `(sha, context)`, and a pull-request comment for `(build)`.

There is no separate git-host option; git providers are listed in `ShelfOptions.notifications.notifiers`. Git
providers are write-only: nothing reads from a git host during capture, and a build of a commit
that is already merged is captured like any other (there is no `isMerged` check).

### 3. Three packages, split by identity and dependency weight

- **`@storyshelf/notify-email`** owns `nodemailer`, with `smtp`, `mailpit`, `log` and HTTP-API
  presets.
- **`@storyshelf/notify-chat`** is zero-dependency, `fetch` only: `slack-webhook`,
  `teams-workflow`, `log` (Mattermost and Discord can follow as renderers).
- **`@storyshelf/notify-git`** is zero-dependency like `notify-chat` (calls go through `httpJson`): `github`, `gitlab`, and a `git-log` provider for tests and local runs (`log` is taken
  by `notify-chat`, and provider kinds are unique across packages).

They are packages, not part of `@storyshelf/core`, because core carries none of the provider code or
SDKs (single owner per third-party dependency, ADR 0001 Architecture and Conventions). Channels needing a
different identity (WhatsApp with phone numbers and template approval) would be separate packages.

### 4. Storage

- **`webhooks`** stays as is; machine and human payloads converge only at the emitter.
- **`notification_channels`** (`project_id NULL`, `provider`, `config` JSON, `secret_encrypted NULL`,
  `events NULL` = all, `enabled`). A `NULL` project means a site-wide channel for `sys:*` admin
  events. Git channels are project-scoped rows; their events column is fixed, since state channels
  react to build state, not to a topic list. Each channel row also records its last delivery error
  and time.
- **`notification_subscriptions`** (`project_id`, `user_id`, `events`, `via` = `["email"]`,
  `enabled`, `UNIQUE(project, user)`).

Git credentials use the same encryption and secret rules as other channel secrets. Status channels
and notification channels are managed on one settings page.

### 5. Statuses are a function of build state

One function maps a build to the states its git channels should show, and is called on every build
transition and when publishing finishes. It is independent of the capture pipeline, so a build that
was never captured still posts its statuses. The transport never sees an event it must order; it
sees "make the host show the current state of this build".

| Context              | Posted when                       | Meaning                                                                                                                                                                                                                                  |
| -------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<prefix>/testing`   | `testing` is on                   | `pending` on creation, `success` when all new and changed snapshots are approved, `failure` when changes are rejected. Its description says whether review is still open.                                                                |
| `<prefix>/review`    | `testing` is off and review is on | `pending` on creation (with several approvals required the description shows `Waiting for approvals: 1 of 2`), `success` or `failure` from the build-level verdict. With review off an accepted build shows `success` (`Review is off`). |
| `<prefix>/storybook` | every build with a commit SHA     | `success` when publishing finishes, targeting the published Storybook; `failure` if publishing fails. Informational, not a gate.                                                                                                         |

The function (`statusesForBuild`, in the notifier module of core) is pure: it takes the build, the
channel's prefix, absolute links from the resolved public origin and the `testing` and review flags, and returns
the statuses and the pull-request comment. Its details:

- `testing` is `pending` while the build is captured and while review is open (the description
  counts the changes left), `success` when approved, `failure` when rejected or capture failed,
  `cancelled` (description `Cancelled`) when a user cancelled the build. `review` closes the same
  way. `NotifierState` gains `cancelled`; the providers map it to the host's nearest state: GitLab
  `canceled`, GitHub `error` (it has no cancelled commit state). The pull-request comment says
  `Cancelled` on the gate line.
- `storybook` is `success` once the build's published Storybook exists (its manifest is the marker,
  because it is written last), `failure` for a `failed` build that never published, and `pending`
  otherwise. Capture failing does not fail it: the Storybook is published independently (ADR 0006).
- A build without a commit SHA, or with a synthetic local identity, shows nothing.
- Links are always absolute: the function takes a URL builder over the resolved public origin, and
  no state is requested or delivered while none resolves (decision 11).
- `review` is part of the function and is posted when `testing` is off and the review flag is on
  (the flag is the project's review switch). Its `pending` description shows approval progress when
  several approvals are required (the delivery reads the build's reviews). With the flag off, an
  accepted build shows a final `success` (`Review is off`), so a status left `pending` when review
  was on is closed.

Which statuses exist and what decides them is defined in ADR 0013 UI Review. The prefix is a field
of the git channel's config, default `storyshelf`, with no project slug. A repository that holds
several projects sets a different prefix per channel (`storyshelf-web`, `storyshelf-docs`) so their
statuses do not collide and each can be required on its own.

### 6. Pull-request comments

A pull-request comment is a `state` target: one comment per `(build)`, keyed by a URL marker, and
rewritten as the build's state changes. Its content comes from the same function as the statuses:
links to the build's own page and published Storybook, the changeset summary when review is on, the
visual summary when `testing` is on. A provider without comment support skips it.

### 7. Durable, latest-wins state delivery

State delivery runs as `notify` jobs on the database queue (ADR 0006 Testing Option, Hosting-Only
Mode and the Database Queue), a job kind beside `capture` and `publish`:

- A job names a channel and a build, not a status. At delivery it reads the build's current state
  and sends that, so a retried or reordered job cannot post a stale status, and duplicate jobs for
  the same `(channel, build)` collapse.
- Retries use backoff up to a fixed attempt count. After the last attempt the failure is logged, the
  channel row shows the last error and time on the settings page, and a `sys:notify-failed` admin
  event fires through the system notification channel.
- Leases, fencing and redelivery are the queue's; there is no second implementation.

Details of the job kind:

- **Where it runs.** `notify` jobs have a queue instance and a consumer of their own (four
  deliveries at once), next to the main one: a status must not wait behind a capture that holds
  every slot for minutes. Their rows live in `capture_jobs` like any other job, and the queue views
  (`status`, `active`, `recent`, `cancel`) leave them out so they do not bury a build's capture and
  publish jobs.
- **Enqueue.** Every build transition and the end of publishing request the build's state. A
  request queues one job per enabled git channel unless a job for the same `(channel, build)` is
  still waiting: that one reads the state when it runs. A running job may have read an older state,
  so a new one queues behind it. A forked capture child queues its jobs on the database queue; the
  parent's consumer runs them.
- **Retries.** A job allows five attempts and the retry delay doubles from 10 s to at most five
  minutes (a job states its own attempts and its handler its own backoff; the capture defaults are
  untouched). The consumer retries, the handler only fails.
- **Failure.** The last attempt, or a last attempt that lost its lease, records the sanitized error
  and its time on the channel row and raises `sys:notify-failed` (channel, project, build, error)
  to the site-wide channels. Those deliver messages, which are not retried through `notify`, and a
  git channel is always project-scoped, so a failing alert cannot raise another. A successful
  delivery clears the error. A channel or build that no longer exists is dropped and the job acked.

On a host with no queue consumer (a hosting-only instance on a serverless platform), state is
delivered inline in the request or publish path, through the shared HTTP helper's timeout and retry
(ADR 0001), without durability. The settings page says so.

### 8. Message delivery is inline and best-effort

Message channels (chat, email) are sent inline with `Promise.allSettled`; a failure is logged and
never fails the triggering action. Messages have no state to converge, so a durable outbox and
retries are non-goals for them. While no public origin resolves they are not sent at all
(decision 11).

### 9. Shared plumbing

- `core/adapter/email-sender.ts` defines `EmailSender`, used by notification fan-out and optionally
  by auth for invites and resets.
- A pure `format.ts` renders messages from the `UIConfig` brand, `publicBaseUrl` links and
  per-channel toggles; the settings preview reuses it. There are no custom templates.
- `events.ts` provides `emitNotifications` and `emitSystemNotification`. Background emitters with no
  request scope (in-process capture completion, scheduled purge) use explicit-dependency variants
  (`notifySystemWith`).
- All outbound sends go through `httpJson` (ADR 0001), including webhook delivery.

### 10. Event catalog

One topic catalog serves webhooks and notifiers.

- **Project topics:** `build:*` (including `build:cancelled`, raised by a user cancel; never
  default-on and never `build:failed`), `baseline:*`, `comment:created`, `review:requested`,
  `review:comment`, `review:verdict`, `insight:ready` (ADR 0016 AI Insights).
- **Admin topics:** `sys:user-created`, `sys:invite-issued`, `sys:auth-failed`,
  `sys:capture-failed`, `sys:purge-completed`, `sys:notify-failed`, `sys:ai-budget` (ADR 0016).

Subscriptions are opt-in: no subscription row means silence. The exception is `review:requested`,
on by default for a project's approvers and admins and switchable off per user (ADR 0013).

### 11. Auth mail

- `ShelfAuthOptions` accepts `emailSender` (the same transport instance notification channels use,
  so `nodemailer` has one owner), `fromEmail`, a `logger`, and one `onAuthSystemEvent(event, data)`
  hook for `sys:user-created` and `sys:invite-issued`. The hook is best-effort (failures logged,
  never break auth) and fires from both the user-mirror hook (first SSO or social login) and the
  invite-accept wrapper, since direct credential writes bypass the auth engine's database hooks.
- Invites are best-effort email: the link is sent when a sender is set, and the token is always
  returned, so auth without SMTP keeps working with out-of-band invite links.
- Password resets use `sendResetPassword` when a sender is set; admin re-invite stays available
  regardless.
- `sys:auth-failed` fires on local-login credential failures only (`POST /auth/engine/login` 401s,
  never 429 or 5xx noise, never secrets); bursts are bounded by the `/auth/*` rate limit.

### 12. Notifications need a public origin

Owner decision (#265): every notification carries or targets an absolute link, so none is sent while
the public origin resolver (ADR 0007, decision 6) finds no origin. The resolver's own semantics
decide what "resolved" means: `publicBaseUrl`, the platform address, or the origin an admin's browser
confirmed (stored; a report nobody confirmed does not count, ADR 0007). Covered: git statuses and the pull-request
comment, and every message notification (project events, review events, site-wide `sys:*` alerts) to
chat, email and log channels and per-user subscriptions. Not covered: signed webhooks, which carry
ids and no links, and authentication mail (invites, password reset), which is not a notification
channel.

While paused nothing is queued and no inline delivery runs, no channel is marked as errored (the
pause is not a delivery failure), the System page, the project notification settings and the profile
page show "Notifications are paused until a public URL is set; set `PUBLIC_BASE_URL` or confirm the
detected origin", and one `warn` line is logged at boot and the first time a notification is
skipped. A request dropped while paused is not replayed, with one exception: when an admin confirms
the first origin on the System page, the state of every recent build still `pending`,
`capturing`, `comparing` or `reviewing` is requested again (`requestOpenBuildStates`). A host that
gets its origin through configuration (`PUBLIC_BASE_URL`, needs a restart) replays at boot instead:
once adapters are ready, with notifiers wired and an origin resolved, `runBootTasks` requests the
state of open builds (newest 25 per project) once with the same `requestOpenBuildStates`. Only git
state is replayed; chat, email and alerts resume with the next state change. A `notify` job that finds the origin gone when it runs is acknowledged and writes
nothing.

### 13. GitHub check runs sit beside commit statuses (merge gate v2)

Owner decision (epic #27, issues #32, #33, #35). A GitHub channel shows a build as commit
statuses (default, `mode: "statuses"`, a token) or as **check runs** (`mode: "checks"`, a GitHub
App); GitLab keeps statuses, which join the commit's pipeline. There is no third target kind and no
new provider: both modes are driven by the same pure `statusesForBuild`, which now also says how
far a `pending` status is (`progress`: `queued` before capture, else `running`), marks the Storybook
status `informational` and attaches the per-snapshot `annotations` to `<prefix>/testing`. A pure
mapper in `notify-git` (`github-check-mapper.ts`) turns a desired status into the check-run payload;
nothing posts from a call site.

- **Credentials** are per channel: `appId` and `installationId` in the channel config, the private key
  (PEM) as the channel secret, so it is encrypted at rest, never returned by the API or UI, and covered
  by `redactSecrets` (PEM blocks and JWTs). The provider signs an RS256 JWT with `node:crypto`, trades it
  for an installation token with `httpJson` and caches it per channel until five minutes before expiry.
  No PAT, no new dependency.
- **Lifecycle:** `queued` (build not captured), `in_progress` (capturing, comparing, review open),
  `completed` with `success`, `failure`, `cancelled` (the `cancelled` build status) or `neutral` (the
  informational Storybook status failing). A run is found by head SHA and the stable `external_id`
  `storyshelf:<context>` and updated, never duplicated. The details URL is absolute (decision 12 already
  pauses delivery without a confirmed origin).
- **Annotations:** one per `new` or `changed` snapshot, titled by story, viewport and browser,
  anchored at the story file, with `raw_details` the snapshot's review URL (`UrlBuilder.snapshot`, the
  diff page with `?snapshot=<id>`). `MAX_ANNOTATIONS` (200) caps the build state, GitHub takes 50
  per request so they go out in batches of 50 through check-run updates, and the summary says `and N
more changed snapshots` with the build link. A delivery skips the annotations the run already holds
  (`output.annotations_count`), so a retry never doubles them; GitHub cannot remove annotations, so one
  for a change approved later stays on the run.
- **Branch protection** stays the owner's step, but `storyshelf protect` (CLI) prints the exact required
  check, validates the branch's rule through the host API and writes only with `--apply` (additive:
  it adds the missing check, or creates a rule on an unprotected branch; GitLab: the "pipelines must
  succeed" project setting).

## Consequences

**Positive**

- A working merge gate with only a commit status and branch protection; no OAuth App or extra
  service is required.
- One outward-integration mechanism, one settings page and one place for channel health.
- Merge-gate statuses survive a restart or a transient provider outage and never go stale.
- Git hosts are not special inside capture; the family is write-only.
- Machine (webhook) and human (notifier) payloads stay decoupled over one topic catalog.

**Negative**

- The gate depends on the repository owner configuring branch protection, a manual step
  (`storyshelf protect` validates and can write it, decision 13).
- A PAT for status writes is a credential to manage and rotate (a GitHub App channel avoids it).
- Status delivery is asynchronous: a status can lag the build change by a queue polling interval.
- Hosting-only instances without a queue consumer get no durability for statuses.
- Per-user chat DMs, phone-number channels and custom templates are not supported.

## Alternatives considered

- **Keep git hosts as a separate family and make only their delivery durable.** Rejected: two
  families and two settings pages for one kind of work, with a durable path built for git alone.
- **Make every notification durable.** Rejected: messages have no state to converge, so retries
  would risk duplicates.
- **Send statuses as webhooks.** Rejected: a webhook is a signed machine payload for the consumer to
  interpret; a status needs the provider's API and credentials.
- **Per-project status names (`storyshelf/<slug>`).** Rejected for a channel-level prefix, which
  keeps names short and still separates projects sharing a repository.

## Open questions

- Auto-rejecting a pull request when a build is rejected (the check run already ends `failure`).
- GitHub rulesets and GitLab external status checks are not read by `storyshelf protect`.
- Polling cadence and cost of `notify` jobs on metered databases such as Turso.
- Rate limits: GitHub secondary limits on bursts of statuses across many builds.
