# ADR 0038: Environment Migration and Baseline Review

## Status

Accepted as the target behavior. Implementation is pending; ADR 0009 describes current behavior
until it is changed. This decision amends ADR 0009's environment migration and review presentation.

## Context

Browser versions can change when an operator upgrades StoryShelf or a capture adapter; project
owners do not necessarily control them. ADR 0009 automatically replaces default-branch baselines
when known fingerprint components change, without a pixel comparison. That keeps the default branch
moving but can hide a product regression that landed alongside the environment change. Requiring
per-snapshot approval after code is already merged can impose substantial work without preventing
that merge.

Branch baselines avoid repeatedly reviewing changes already accepted on a feature branch. However,
a reviewer may not know whether a comparison uses an accepted branch baseline or the default
branch, and the latter can move while a branch is open.

## Decision

- Keep automatic migration on the default branch. For each captured baseline with a known
  environment change, preserve the previous screenshot and fingerprint before making the new
  capture active. Report the result as **environment migrated**, not as proof of unchanged pixels.
  Provide access to the old and new images and a comparison where possible, clearly warning that
  environment differences may contribute. If comparison is unavailable, say so.
- Capture is incremental: migrate only identities actually captured. Uncaptured baselines retain
  their previous environment until a later capture. Summarize migration counts for each build;
  do not imply an entire project has migrated.
- Preserve one previous baseline per identity initially, including fingerprint and migration time.
  Define retention and repeated-migration behavior in implementation, with safe cleanup and clear
  documentation. Provide a way to retrieve the old image. Restoring a baseline does not restore
  the old browser; a restore workflow must explain subsequent migration or diff noise.
- On feature branches, retain the existing pixel comparison and show a mismatch when known
  environment fields differ. Warn by default; allow projects to opt into blocking the git check on
  mismatch. The policy must explain how it interacts with other build failures and review status.
  Unknown fingerprint components are not evidence of a mismatch; preserve existing compatibility
  behavior for old baselines.
- Keep baseline selection per project, story, mode, target and branch: use an accepted branch
  baseline if present, otherwise the default-branch baseline. A pending or rejected capture does
  not become a baseline. Never silently replace an accepted branch baseline with a newer default
  baseline. Display each diff's source, reference build or commit when available, and time, as well
  as environment mismatch. Make a comparison with current default-branch baseline available as a
  secondary view when it differs, without changing the primary review or approval target.
- Surface an instance-level notice when an upgrade causes migrations, and project-level information
  for the affected project. Do not expose one project's details to another project's users.

## Consequences

Automatic migration preserves continuity but cannot prevent a regression already merged to the
default branch. Previous images and an honest status support investigation and remediation. A
strict feature-branch policy can stop merges on environment mismatch but can also block projects
after an operator upgrade. Keeping historical images and a secondary comparison increases storage
and UI complexity; neither changes which baseline approval updates.

## Implementation questions

Choose an explicit retention period and behavior when a second migration occurs before the first
previous image expires. Define consistency between baseline updates, retained references and
retention, including concurrent builds. Specify the exact check status and behavior when the
comparison or reference metadata is unavailable. These details must not weaken the decisions above.
