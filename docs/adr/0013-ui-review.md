# ADR 0013: UI Review

## Status

Accepted

Supersedes (archived): ADR 0035

## Context

StoryShelf separates its checks (`testing`: render, compare, accessibility, `play` tests; ADR 0006
Testing Option, Hosting-Only Mode and the Database Queue) from publishing and hosting. Review is the
third concern: the place where people comment on a build and sign it off. Chromatic makes the same
split between UI Tests, which find changes, and UI Review, which collects comments and sign-off.

Review must work whether or not a project captures screenshots. Snapshot approval (ADR 0009
Baselines, Approval and Retention) only exists for captured builds, so review needs its own
build-level verdict, comment anchors that do not require snapshots, a status check that does not
depend on capture, and a notion of what changed without screenshots.

## Decision

### 1. `review` is a project setting, on by default

A boolean on the project (`projects.review_enabled`, default `true`), edited by project admins and
exposed in the project API and settings page. There is no `ShelfOptions` field for it. An
instance-level option would be added only if review gains operator configuration of its own.

Default-branch builds are always accepted automatically, so the project's Storybook link always
resolves. Review works in all four combinations of `testing` and `review`:

| `testing` | `review` | A build                                                                                                                                |
| --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| off       | off      | Accepted when publishing finishes. No comments, no sign-off, no review status.                                                         |
| off       | on       | Default branch: accepted when publishing finishes. Other branches: `pending`, comments, build-level verdict, `<prefix>/review` status. |
| on        | off      | Comments and sign-off routes hidden: snapshot approval alone decides.                                                                  |
| on        | on       | Snapshot approval decides, plus build and story comments, a build-level verdict and the changeset.                                     |

Turning `review` off hides comments and verdicts (hidden, not deleted). It also accepts, in one
pass at save time, the project's builds left `pending` that have no attempts and no snapshots, so a
project that switches review off does not keep a queue nobody will clear.

### 2. Comments anchor to a build, a story or a snapshot

`comments` carries a nullable `storyId` (the Storybook story id from the catalog built from
`index.json`) and a nullable `snapshotId` for builds with snapshots. An anchor is exactly one of:
build (both null), story (`storyId`), snapshot (`snapshotId`). A story comment on a build that is
later captured stays attached to its story; the snapshot view shows the story comments for its
story. Replies use `parentId`. Component pages list the comments of the build they show.

### 3. A build-level verdict

A `build_reviews` table: `id`, `buildId`, `userId`, `verdict` (`approved` | `rejected`), `body`
(optional), `createdAt`. A reviewer's latest row is their verdict. Only `approver` and `admin` may
write one, the same roles that approve snapshots, so the merge-gate reasoning of ADR 0014 Git Hosts
and Notifications holds.

What decides the build's status:

- **`testing` off.** `approved` once the project's required approvals are present
  (`projects.review_approvals`, default 1) and no latest verdict is `rejected`; `rejected` when any
  latest verdict is. Otherwise `pending`.
- **`testing` on.** The snapshot rollup decides, and approving the last snapshot approves the build.
  A build-level verdict is available as a sign-off but does not gate, so enabling review does not
  change when a captured build turns green.

A verdict is rewritable. Verdicts belong to the build, as snapshot approvals do: a new push to the
branch does not carry a verdict over.

### 4. Reviewers, assignment and comments

- **Who reviews.** The `approver` and `admin` roles are the reviewers; there is no separate reviewer
  role. Every approver and admin of the project is a reviewer of every build awaiting review. There
  is no per-build assignment, no component ownership rule and no "request review from" step.
- **Being asked.** When a build becomes `pending` with review on, a `review:requested` event goes to
  the project's approvers and admins through the notification channels and their per-user
  subscriptions (ADR 0014). Unlike other topics, which are opt-in, this one is on by default for
  those roles and can be turned off per user.
- **Who may comment.** `developer`, `approver` and `admin` write build, story and snapshot comments;
  `viewer` reads only.
- **Unresolved comments do not block.** A verdict is allowed with open threads. Resolving is a
  courtesy to the next reader, not a gate, and nothing counts unresolved comments.
- **A new build needs a new approval.** Approving build N says nothing about build N+1 on the same
  branch. The build under review is the latest one on the branch; earlier pending builds fall away
  under decision 9.

### 5. Statuses posted for review

Review defines which git-host statuses exist; ADR 0014 defines their names and how they are
delivered. The prefix is the git channel's configurable name, default `storyshelf`.

- **`<prefix>/review`.** Posted when `testing` is off and review is on: `pending` when the build is
  created, `success` or `failure` from the verdict. With `testing` on, `<prefix>/testing` stays the
  only gating status and its description says whether review is still open; review never adds a
  second required check.
- **`<prefix>/storybook`.** Posted on every build with a commit SHA, whatever `testing` and `review`
  are set to: `success` when publishing finishes, with the published Storybook's URL as its target,
  `failure` if publishing fails. It is informational, not a merge gate. It gives hosting-only
  projects the pull-request link to the Storybook that Chromatic's publish check gives. When a build
  has a pull request and the provider supports comments, the per-build comment carries the same link.

All statuses are computed from build state, not from the capture pipeline, so a build that was never
captured still posts them. A project with no git channel configured posts nothing.

### 6. Reaching a build that is waiting

A build's own URLs (its page, its published Storybook by build id) answer for anyone who may view
the project, whatever the build's status. A pending build is not the project's _latest accepted_
build: the project's Storybook link and upstream links keep resolving the previous accepted build
until this one is approved. The status target, the pull-request comment and the `review:requested`
notification therefore all link to the build's own URL.

### 7. Design previews in review

When a story carries a design link and a design provider is configured (ADR 0018 Design Providers),
the story's review view shows the design beside the live story, as the component page does. With
`testing` on, the link comes from the recorded story parameters. With `testing` off the catalog comes
from `index.json`, which carries no story parameters, so no per-story design is shown. The story
itself still shows, and nothing in review depends on the design.

### 8. The changeset without screenshots

With `testing` off the build page shows a component and story changeset computed from the catalog
(`build_components` hash per component) against the baseline build: the latest accepted build of the
branch, falling back to the default branch, the rule baselines use. It lists components added,
removed and changed (the story set, args or source hash differ), each linking to the published story
and to its component page. With `testing` on, the same list sits above the visual diffs.

This is a coarser signal than pixels and is presented as such: a changed hash means the story's
definition changed, not that it looks different. `@storyshelf/affected` is not required and is not
run.

### 9. Reviews that nobody finishes

A `pending` build is not served as the Storybook link. Reviewable builds have an exit:

- A `pending` build with no attempts, no verdicts and no comments is superseded when a newer build
  exists for the same branch, and becomes purgeable like a `rejected` build.
- Any other `pending` build becomes purgeable after the project's retention window, measured from its
  last activity (comment, verdict or upload), not from creation.

These two cases are part of the retention rule of ADR 0009. They add no build status.

### 10. Routes, API, MCP and events

- **Route class.** The `review` route class holds comments (list, create, resolve), build verdicts
  (create, list), the changeset, the review section of the build page and the project review
  settings. It is gated by the project's switch, so the gate is evaluated per request. The route
  completeness test enumerates these routes, and a second test asserts they answer 404 when the
  project has review off.
- **MCP.** The MCP server (ADR 0017 MCP Server) stays read plus comment. Comments are `review` routes;
  the verdict is not exposed, because an agent must not be able to sign off a build.
- **Webhooks and notifications.** Events `review:comment` and `review:verdict` are delivered through
  the existing webhook and notifier paths (ADR 0014); there is no new transport.
- **Auth.** Review never widens who can view a project (ADR 0011 Authentication and Access).

## Consequences

**Positive**

- A team can use StoryShelf as a reviewed Storybook host, as Chromatic's UI Review is used, with no
  capture infrastructure.
- Captured projects gate exactly as snapshot approval decides; review adds comments and sign-off
  without a second gate.
- One switch per project, owned by the project admin.

**Negative**

- Review on by default means a hosting-only project's builds on non-default branches wait until
  someone approves them or the project switches review off, and the Storybook link keeps resolving
  the previous accepted build until then. The default branch is never held.
- Schema surface: `comments.storyId`, `build_reviews`, `projects.review_enabled`,
  `projects.review_approvals`, and a wider retention rule.
- A hash-based changeset overstates change when stories are re-saved without a visible effect.

## Alternatives considered

- **A `review` umbrella option on `ShelfOptions`.** Rejected: review needs no operator
  configuration, and a project admin already owns the decision.
- **Review as part of `testing`.** Rejected: it ties sign-off to renderer infrastructure and leaves
  hosting-only teams unable to review.
- **Holding default-branch builds for review.** Rejected: the default branch is always accepted
  automatically, so the project's Storybook link always resolves.
- **A second required status next to the testing one when `testing` is on.** Rejected: two checks
  would disagree about "approved".

## Open questions

- Whether the required-approvals count and the retention window are project settings or defaults
  only.
- How comments on a story survive when the story is renamed or removed between builds.
