# ADR 0010: Git Provider Merge Gate (Status Checks Now, GitHub App Later)

## Status

Accepted

## Context

Visual testing only pays off when it *blocks bad merges*. Users want to integrate StoryShelf with GitHub or GitLab so a PR cannot merge until its visual changes have been reviewed and approved in StoryShelf.

Two levels of integration exist:

1. **Required commit status** (v1): StoryShelf posts a commit status on the PR head SHA. The repo owner marks that status as required in branch protection (GitHub) or a required pipeline/approval rule (GitLab). The provider then blocks the merge until StoryShelf reports `success`. This requires no OAuth App — only a token that can write statuses.

2. **Rich check runs + auto-reject** (v2): a GitHub App (Checks API) or GitLab integration that posts granular check runs with per-snapshot annotations deep-linking to the diff, and can reject a PR when review is rejected.

## Decision

**v1: commit status via the existing status adapter.** The status adapter interface already exists in `ShelfOptions`. It:

- Posts `pending` when a build is created.
- Posts `success` when all `new`/`changed` snapshots are approved.
- Posts `failure` when changes are rejected or remain unresolved.

It authenticates with a **separate, per-project Git credential** (PAT or app installation token), *not* the CLI project token — the project token identifies a build, while the status credential authorizes writes to the repo. Posting statuses is the user's explicit opt-in; no statuses are posted without it.

**v2: GitHub App / GitLab integration.** Rich check runs, per-snapshot annotations, deep links to the review UI, and auto-reject. The app is repo-installed (no long-lived PAT), receives webhooks to know when builds are resolved, and is the natural home for future merge confirmation.

## Relationship to roles (ADR 0008)

The merge gate is why **approver** and **developer** are distinct roles: developers push and re-run builds, but only approvers (and admins) can accept snapshots — and a `success` status requires all snapshots to be approved. This separation makes the "who can green-light a merge" question answerable by role, not by convention.

## Consequences

**Positive:**
- v1 ships with a working merge gate using only a commit status + branch protection
- No OAuth App or long-running service is required to get started
- The status adapter's responsibilities are well-scoped and testable
- Approver/developer split maps cleanly onto the merge-gate workflow

**Negative:**
- v1 depends on the repo owner configuring branch protection (a manual step; a CLI/UI helper can scaffold it)
- A PAT for status writes is a credential to manage and rotate
- Rich per-snapshot annotation UX is deferred to v2

**Migration path:** required status (v1) → GitHub App checks + annotations + auto-reject (v2), without changing the review model or roles.
