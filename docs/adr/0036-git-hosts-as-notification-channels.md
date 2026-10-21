# ADR 0036: Git Hosts as Notification Channels

## Status

Proposed. Builds on ADR 0034 (the database queue) and ADR 0035 (which statuses and comments exist).
Amends ADRs 0010 and 0024 in part; see Amendments.

## Context

Two adapter families send things outward when a build changes, and they have drifted apart.

- **Git hosts** (`GitHostProvider`, registered as `ShelfOptions.gitHosts`; packages `git-github` and
  `git-gitlab`) post commit statuses and one pull-request comment per build, from per-project rows in
  `project_status_configs` with their own credentials. They are called from the capture pipeline
  (`postStatusesForBuild`), which runs every configured provider with `Promise.allSettled`, logs a
  failure and moves on. A third operation, `isMerged`, lets capture skip a build whose commit is already
  merged.
- **Notifiers** (`NotifierProvider`, `ShelfOptions.notifiers`; packages `notify-chat`, `notify-email`)
  send human messages to channels from `notification_channels`, inline and best-effort. ADR 0024 lists
  a durable outbox and retries as non-goals.

ADR 0035 changes what the git side has to do. Statuses are no longer a by-product of capture: a build
that was never captured posts `storyshelf/review` and `storyshelf/storybook`, and a required status is a
merge gate, so a lost update leaves a pull request stuck or wrongly green. The failure mode today is a
log line. With the database queue of ADR 0034 there is now somewhere durable to retry from.

`isMerged` is the one git-host call that reads rather than writes. It is optional, fails open, exists in
two packages, and is used in one place (`capture/skip-checks.ts`).

## Decisions

### 1. A git host is a notifier with state delivery

`GitHostProvider` and `NotifierProvider` merge into one family. A provider declares how it delivers:

- **`message`** (Slack, Teams, email): `send` a formatted message once, as today.
- **`state`** (GitHub, GitLab): `setState` the state of a named thing, idempotent, where the latest call
  wins: a commit status for `(sha, context)`, and a pull-request comment for `(build)`.

`ShelfOptions.gitHosts` is removed; git providers are listed in `ShelfOptions.notifiers`. This is a
breaking change, accepted. Channels are rows of `notification_channels`; a channel's provider decides
its delivery.

### 1a. One package: `@storyshelf/notify-git`

`@storyshelf/git-github` and `@storyshelf/git-gitlab` fold into a new `@storyshelf/notify-git`, named
like `notify-chat` and `notify-email`, with `github` and `gitlab` as its providers (and a `log`
provider for tests and local runs). It is a package, not part of `@storyshelf/core`, because it owns
the `@octokit` dependencies and core carries none of the provider SDKs (the single-owner rule for
third-party dependencies). The two old packages are retired and logged in `docs/deprecated.md`; their
exports are not kept.

### 2. One table, migrated

`project_status_configs` rows become project-scoped `notification_channels` rows (provider, config,
encrypted token, enabled). The events column is fixed for state channels: they react to build state,
not to a topic list. The migration runs at boot for one release, as the other migrations in ADR 0031 and
0034 do, and credentials keep the same encryption and the same `secret` rules. The status settings page
and the notification channels page become one page.

### 3. Statuses are a function of build state, with configurable names

A single function maps a build to the list of states its channels should show: the testing status
(when `testing` is on), the review status and the published-Storybook status (ADR 0035).

Their names are `<prefix>/testing`, `<prefix>/review` and `<prefix>/storybook`. The prefix is a field of
the git channel's config, default `storyshelf`, with no project slug. A repository that holds several
projects sets a different prefix per channel (`storyshelf-web`, `storyshelf-docs`) so their statuses do
not collide and each can be marked required on its own. Existing branch protection that requires
`storyshelf/<slug>` has to be updated once; the migration (decision 2) logs each project's old and new
name. It is called on every build transition and when publishing finishes. The transport never
sees an event it must order: it sees "make the host show the current state of this build".

### 4. Durable, latest-wins delivery

State delivery runs as `notify` jobs on the database queue (ADR 0034 decision 6), a job kind beside
`capture` and `publish`:

- A job names a channel and a build, not a status. At delivery it reads the build's current state and
  sends that. A retried or reordered job therefore cannot post a stale status, and duplicate jobs for
  the same `(channel, build)` collapse.
- Retries with backoff up to a fixed attempt count. After the last attempt the failure is logged, the
  channel's row shows the last error and time on the settings page, and a `sys:notify-failed` admin
  event fires through the system notification channel.
- Leases, fencing and redelivery are the queue's, not a second implementation.

On a host with no queue consumer (a hosting-only instance on a serverless platform, ADR 0034 decision
2), state is delivered inline in the request or publish path, with the shared HTTP helper's timeout and
retry (ADR 0019) and no durability. The settings page says so.

Message channels (chat, email) stay inline and best-effort; ADR 0024's non-goal still holds for them.

### 5. `isMerged` is dropped

Removed from the interface, both packages, `capture/skip-checks.ts` and their tests. A build of a commit
that is already merged is captured like any other. This costs some wasted capture in a case that is
rare, and removes the only place where a git host is read during capture, which makes the family
write-only and the merge with notifiers possible.

### 6. Pull-request comments

`upsertComment` becomes the `state` delivery of a comment target: one comment per `(build)`, keyed by the
existing url marker, rewritten as the build's state changes. Its content is built by the same function
as the statuses: links to the build's own page and published Storybook (ADR 0035 decision 4c), the
changeset summary when review is on, the visual summary when `testing` is on. A provider without
comment support skips it, as today.

## Amendments to existing ADRs

- **0010:** the "status adapter" is a notifier channel with state delivery, delivered durably from the
  queue. The merge-gate semantics, credentials and roles are unchanged.
- **0024:** adds the `state` delivery kind and the durable `notify` path for it; the non-goal of a
  durable outbox now applies to message channels only.
- **0034:** adds the `notify` job kind to the queue and `sys:notify-failed` to the system topics.
- **0035:** statuses and comments are delivered as described here.

## Consequences

**Positive**

- One outward-integration mechanism instead of two, one settings page, one place for channel health.
- Merge-gate statuses survive a restart or a transient provider outage and never go stale.
- Git hosts stop being special inside capture, and `isMerged` and its two implementations go.

**Negative**

- A breaking change: `ShelfOptions.gitHosts` is removed, the table is migrated, the two packages are
  replaced by one, and required-status names change once.
- Delivery is now asynchronous: a status can lag the build change by a polling interval (ADR 0034 uses
  2 s while busy), where today it is posted inline.
- Hosting-only instances without a consumer get no durability for statuses.

## Alternatives considered

- **Keep git hosts separate and make only their delivery durable.** Rejected: it leaves two families and
  two settings pages for the same kind of work, and the durable path would be built once for git alone.
- **Make every notification durable.** Rejected here: messages have no state to converge, so retries
  would risk duplicates, and ADR 0024 chose best-effort deliberately.
- **Send statuses as webhooks.** Rejected: the webhook is a signed machine payload for the consumer to
  interpret, and a status needs the provider's API and credentials.

## Open questions

- Whether a future GitHub App (ADR 0010 v2) is another provider of the same kind, with check runs as a
  third `state` target, or needs its own contract.
- Polling cadence and cost for the `notify` jobs on Turso (ADR 0034's metering question).
- Rate limits: GitHub secondary limits on bursts of statuses across many builds.

## Implementation order

1. The merged provider contract, the `@storyshelf/notify-git` package (moving the two providers, with
   their tests), the `notification_channels` migration and the unified settings page.
2. The state function (decision 3) and inline delivery through the new providers, replacing
   `postStatusesForBuild`.
3. `notify` jobs on the queue, retries, failure surfacing and `sys:notify-failed`.
4. Dropping `isMerged` and updating the two packages' tests.
5. Website documentation and the configuration reference.
