# ADR 0035: UI Review, with or without `testing`

## Status

Proposed. Builds on ADR 0034, which introduced the `review` route class and the auto-accept rule this
ADR completes. Amends ADRs 0010 and 0027 in part; see Amendments.

## Context

ADR 0034 splits StoryShelf's checks (`testing`: render, compare, accessibility, `play` tests) from
publishing and hosting. It left review half-defined. Chromatic makes the same split: its UI Tests find
changes, and its UI Review is where people comment and sign off. What exists today:

- **Comments** (`comments` table) anchor to a build, or to a snapshot through a nullable `snapshotId`.
  Writers are `developer`, `approver` and `admin`; viewers read.
- **Approval** is per snapshot, by `approver` and `admin` (`APPROVER_ROLES`). The build's status is
  rolled up from its snapshots (`rollupStatus`): `reviewing` while any is `new` or `changed`, otherwise
  `rejected` or `approved`. With no snapshots there is nothing to approve.
- **The commit status** is posted by the capture pipeline (`status-fanout`) and answers "are all
  snapshots approved". Nothing posts a status for a build that was never captured.

ADR 0034 decided that a hosting-only build is accepted automatically only when `testing` is off _and_
the project has turned `review` off, and that `review` has no instance-level option: it is on by
default and a project admin switches it. With review on and `testing` off, a build stays `pending`
until someone approves or rejects it at build level. That needs build-level approval, anchors that do
not require snapshots, a status check that does not depend on capture, and a notion of what changed
without screenshots. None of these exist.

## Decisions

### 1. `review` is a project setting, on by default

A boolean on the project (`projects.review_enabled`, default `true`), edited by project admins, exposed in
the project API and settings page. There is no `ShelfOptions` field for it. An instance-level option
would be added only if review gains operator configuration of its own, such as git hosts.

Review works in all four combinations of `testing` and `review`:

| `testing` | `review` | A build                                                                                                                                  |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| off       | off      | Accepted when publishing finishes. No comments, no sign-off, no status check.                                                            |
| off       | on       | Default branch: accepted when publishing finishes. Other branches: `pending`, comments, build-level verdict, `storyshelf/review` status. |
| on        | off      | Today's behaviour, with comments and sign-off routes hidden: snapshot approval alone decides.                                            |
| on        | on       | Today's behaviour plus build and story comments, build-level verdict and the changeset.                                                  |

Turning `review` off hides comments and verdicts (hidden, not deleted, like snapshots in ADR 0034).
It also accepts, in one pass at save time, the project's builds left `pending` that have no attempts
and no snapshots, so a project that switches review off does not keep a queue nobody will clear.

### 2. Comments anchor to a build or to a story

`comments` gains a nullable `storyId` (the Storybook story id from the catalog, ADR 0034 decision 9);
`snapshotId` stays for builds with snapshots. An anchor is exactly one of: build (both null), story
(`storyId`), snapshot (`snapshotId`). A story comment on a build that is later captured stays attached
to its story; the snapshot view shows story comments for its story. Replies keep `parentId`. Component
pages list the comments of the build they show.

The comment routes are class `review` (ADR 0034 decision 8), not `testing`. Their roles do not
change: `developer` and above write, `viewer` reads.

### 3. A build-level verdict

A new `build_reviews` table: `id`, `buildId`, `userId`, `verdict` (`approved` | `rejected`), `body`
(optional), `createdAt`. A reviewer's latest row is their verdict. Only `approver` and `admin` may
write one, the same roles that approve snapshots, so the merge-gate reasoning of ADR 0010 holds.

What decides the build's status:

- **`testing` off.** `approved` once the project's required approvals are present
  (`projects.review_approvals`, default 1) and no latest verdict is `rejected`; `rejected` when any
  latest verdict is. Otherwise `pending`.
- **`testing` on.** Unchanged: on the default branch the build is accepted as it is today; the snapshot rollup decides, and approving the last snapshot approves
  the build. A build-level verdict is available as a sign-off but does not gate, so captured projects
  see no change in when a build turns green.

A verdict is rewritable. A new push to the branch does not carry a verdict over: verdicts belong to the
build, as snapshot approvals do.

### 4. The review status check

With `testing` off, build creation posts `pending` and the verdict posts `success` or `failure`,
through the same status providers and per-project credentials as today (ADR 0010), under the context
`<prefix>/review`, where the prefix is the git channel's configurable name, default `storyshelf` (ADR 0036). With `testing` on the existing status stays the only status and its description
says whether review is still open; review does not add a second required check. The status poster moves
out of the capture pipeline into a small function of build state that both paths call, so a build that
was never captured can still post one. A project with no git status configured posts nothing.

### 4a. A published-Storybook status on every build

Every build with a commit SHA gets a status under the context `<prefix>/storybook`, whatever `testing`
and `review` are set to: `success` when publishing finishes, with the published Storybook's URL as its
target, `failure` if publishing fails. It is informational, not a merge gate, and a repository would not
mark it required. It gives hosting-only projects the same pull-request link to the Storybook that
Chromatic's publish check gives. It is posted by the same state-driven function as decision 4. When a
build has a pull request and the provider supports comments, the existing per-build comment carries the
same link.

### 4b. Reviewers, assignment and comments

- **Who reviews.** The existing `approver` and `admin` roles are the reviewers; there is no separate
  reviewer role. Assignment is automatic: every approver and admin of the project is a reviewer of
  every build awaiting review. There is no per-build assignment, no component ownership rule and no
  "request review from" step.
- **Being asked.** When a build becomes `pending` with review on, a `review:requested` event goes to the
  project's approvers and admins through the notification channels and their per-user subscriptions
  (ADR 0024). Unlike the other topics, which are opt-in, this one is on by default for those roles and
  can be turned off per user.
- **Who may comment.** `viewer` cannot comment; `developer`, `approver` and `admin` can. This is the
  rule for build, story and snapshot comments alike.
- **Unresolved comments do not block.** A verdict is allowed with open threads. Resolving is a courtesy
  to the next reader, not a gate, and nothing counts unresolved comments.
- **A new build needs a new approval.** Verdicts belong to a build (decision 3), so approving build N
  says nothing about build N+1 on the same branch. The build under review is the latest one on the
  branch; earlier pending builds fall away under decision 6.

### 4c. Reaching a build that is waiting

A build's own URLs (its page, its published Storybook by build id) answer for anyone who may view the
project, whatever the build's status. What a pending build is not is the _latest accepted_ build: the
project's Storybook link and the upstream links keep resolving the previous accepted build until this
one is approved. So the status target, the pull-request comment and the `review:requested` notification
all link to the build's own URL, which is how a reviewer reaches a build that is not yet served as the
project's current Storybook.

### 4d. Design previews in review

When a story carries a design link and a design provider is configured (ADR 0029), the story's review
view shows the design beside the live story, as the component page does. With `testing` on the link comes
from the recorded parameters. With `testing` off the catalog comes from `index.json`, which carries no
story parameters; they are left empty (ADR 0034 decision 9), so no per-story design is shown. The story
itself still shows, and nothing in review depends on the design.

### 5. The changeset without screenshots

Reviewers need to know what changed. With `testing` off the build page shows a component and story
changeset computed from the catalog (`build_components` hash per component, ADR 0034 decision 9)
against the baseline build: the latest accepted build of the branch, falling back to the default
branch, the rule baselines already use. It lists components added, removed and changed (the story set,
args or source hash differ), each linking to the published story and to its component page. With
`testing` on, the same list sits above the visual diffs. This is a coarser signal than pixels and is
presented as such: a changed hash means the story's definition changed, not that it looks different.
`@storyshelf/affected` is not required and is not run.

### 6. Reviews that nobody finishes

A `pending` build is not served as the Storybook link and is not purged today (ADR 0034 decision 9).
Reviewable builds need an exit:

- A `pending` build with no attempts, no verdicts and no comments is superseded when a newer build
  exists for the same branch, and becomes purgeable like a `rejected` build.
- Any other `pending` build becomes purgeable after the project's retention window, measured from its
  last activity (comment, verdict or upload), not from creation.

This extends the retention rule of ADR 0009 from terminal statuses to these two cases. It does not add
a build status.

### 7. Routes, API, notifications

- **Route class.** `review` holds: comments (list, create, resolve), build verdicts (create, list),
  the changeset, the review section of the build page and the project review settings. Gated by the
  project's switch, not the instance, so the gate is per request. ADR 0034's completeness test
  enumerates them and a second test asserts they answer 404 when the project has review off.
- **MCP.** ADR 0027 keeps the server read plus comment. Comments are `review`; the verdict is not
  exposed, because an agent should not be able to sign off a build.
- **Webhooks and notifications.** New events `review:comment` and `review:verdict`, delivered through
  the existing webhook and notify packages; no new transport.
- **Auth.** Unchanged (ADR 0034 decision 1). Review never widens who can view a project.

## Amendments to existing ADRs

- **0034:** decision 1's auto-accept rule is as written there; decision 8's `review` class is defined
  here; the open question about review without snapshots is answered by this ADR.
- **0010:** the merge gate's status comes from build state, not only from capture. `storyshelf/review`
  is posted when `testing` is off, and `storyshelf/storybook` on every build.
- **0027:** comments are `review`; the verdict stays out of MCP.
- **0009:** retention also reclaims the two `pending` cases of decision 6.

## Consequences

**Positive**

- A team can use StoryShelf as a reviewed Storybook host, as Chromatic's UI Review is used, with no
  capture infrastructure.
- Captured projects behave exactly as before.
- One switch per project, off by default only where a project admin chooses.

**Negative**

- Review on by default means every hosting-only project's builds wait until someone approves them or
  the project switches review off. Builds on other branches wait, and the Storybook link keeps resolving the previous accepted build
  until they are approved; the default branch is never held.
- A schema change for `comments` (`storyId`), two tables or columns (`build_reviews`,
  `projects.review_enabled`, `projects.review_approvals`) and a retention change.
- A hash-based changeset overstates change when stories are re-saved without a visible effect.

## Alternatives considered

- **A separate `review` umbrella option on `ShelfOptions`.** Rejected: review needs no operator
  configuration today, and a project admin already owns the decision.
- **Review as part of `testing`.** Rejected: it ties sign-off to renderer infrastructure and makes
  hosting-only teams unable to review.
- **Holding default-branch builds for review.** Rejected: the default branch is special and is always
  accepted automatically, so the project's Storybook link always resolves.
- **A second required status next to the visual one when `testing` is on.** Rejected: two checks
  would disagree about "approved".

## Open questions

- How git-host statuses and comments are delivered is decided in ADR 0036; this ADR defines which
  statuses and comments exist.
- Whether the required-approvals count and the retention window are project settings or defaults only.
- How comments on a story survive when the story is renamed or removed between builds.

## Implementation order

1. `comments.storyId`, `build_reviews`, `projects.review_enabled` and `projects.review_approvals`, with
   migrations for every database package, models and tests.
2. The status function independent of capture, and `storyshelf/review`.
3. Verdict routes, build-status derivation with `testing` off, and the auto-accept rule (default
   branch always, other branches when `review` is off).
4. The changeset from the catalog, and the build and component pages' review section.
5. The route class, its two tests, MCP and OpenAPI markers, webhooks.
6. Retention for decision 6, the switch-off pass, and the website documentation.
