# ADR 0014: Git Hosts and Notifications

## Status

Accepted

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
- **`@storyshelf/notify-git`** owns the `@octokit` dependencies: `github`, `gitlab`, and a `log`
  provider for tests and local runs.

They are packages, not part of `@storyshelf/core`, because core carries none of the provider SDKs
(single owner per third-party dependency, ADR 0001 Architecture and Conventions). Channels needing a
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

| Context              | Posted when                       | Meaning                                                                                                                                                                   |
| -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<prefix>/testing`   | `testing` is on                   | `pending` on creation, `success` when all new and changed snapshots are approved, `failure` when changes are rejected. Its description says whether review is still open. |
| `<prefix>/review`    | `testing` is off and review is on | `pending` on creation, `success` or `failure` from the build-level verdict.                                                                                               |
| `<prefix>/storybook` | every build with a commit SHA     | `success` when publishing finishes, targeting the published Storybook; `failure` if publishing fails. Informational, not a gate.                                          |

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

On a host with no queue consumer (a hosting-only instance on a serverless platform), state is
delivered inline in the request or publish path, through the shared HTTP helper's timeout and retry
(ADR 0001), without durability. The settings page says so.

### 8. Message delivery is inline and best-effort

Message channels (chat, email) are sent inline with `Promise.allSettled`; a failure is logged and
never fails the triggering action. Messages have no state to converge, so a durable outbox and
retries are non-goals for them.

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

- **Project topics:** `build:*`, `baseline:*`, `comment:created`, `review:requested`,
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

## Consequences

**Positive**

- A working merge gate with only a commit status and branch protection; no OAuth App or extra
  service is required.
- One outward-integration mechanism, one settings page and one place for channel health.
- Merge-gate statuses survive a restart or a transient provider outage and never go stale.
- Git hosts are not special inside capture; the family is write-only.
- Machine (webhook) and human (notifier) payloads stay decoupled over one topic catalog.

**Negative**

- The gate depends on the repository owner configuring branch protection, a manual step.
- A PAT for status writes is a credential to manage and rotate.
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

- Whether a GitHub App (repo-installed, no long-lived PAT, rich check runs with per-snapshot
  annotations and deep links, auto-reject) is another `state` provider with check runs as a third
  target, or needs its own contract.
- Polling cadence and cost of `notify` jobs on metered databases such as Turso.
- Rate limits: GitHub secondary limits on bursts of statuses across many builds.
