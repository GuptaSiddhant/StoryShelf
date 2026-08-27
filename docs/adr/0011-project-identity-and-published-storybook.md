# ADR 0011: Project Identity & Published Storybook

## Status

Accepted

## Context

A company may run several Storybooks across teams — a design system plus multiple apps — some of them in monorepos. Two questions follow:

1. What does a "project" map to when a repo hosts more than one Storybook?
2. Does StoryShelf only show diff reviews, or does it also let non-engineers (designers, managers) browse the components?

## Decision

### A project is one Storybook, not one git repo

`projects.git_repository` is an optional link. Many projects may point at the same repo, so a monorepo hosting several Storybooks becomes one project per Storybook. The CLI targets a project explicitly (via its project token), and each uploaded build is exactly one Storybook. Projects also get a unique, human-readable `slug` for shareable URLs (published Storybook, label pages).

Consequence: status checks post under a distinct context per project (`storyshelf/<project-name>`), so two projects on the same commit don't collide (ADR 0010).

### Published Storybook is a first-class surface

Every uploaded build carries a browsable Storybook. StoryShelf publishes it:

- The published Storybook for a project is the most recent build whose branch is public.
- A build is public iff `builds.public = true` or `builds.git_branch` matches `projects.public_branch_regex` (e.g. `^main$`, `^release-`).
- Public builds are viewable **without auth**; every other Storybook requires auth plus at least `viewer` membership on the project (ADR 0008).
- Optionally served on a per-project subdomain (`publishedBaseDomain` + wildcard DNS/TLS), which serves the Storybook at the domain root — no asset rewriting. Subdomains are for sharing only; the review UI remains path-based on the main domain.

### Published builds follow the same purge rules

No special retention for published builds — they are purged like any other build. Because retention keeps the most recent build per branch, the latest public build on a branch survives purge; if it is purged, the published URL falls back to the next-most-recent public build (or 404 until a new build lands).

## Consequences

**Positive:**
- Designers and managers get a browsable component surface with no CI or code access
- Monorepos are supported without a special model (one project per Storybook)
- Public sharing is opt-in and scoped to specific builds/branches, so test builds stay private

**Negative:**
- The "latest public build" can change as builds are purged; links to a purged build may 404
- Public Storybooks need a robots/cache policy to avoid indexing test content

## Relationship to linked projects (v2)

Design-system propagation — re-diffing dependent projects when a dependency's baseline changes — is deferred to v2 and modeled as a future dependency edge between projects, not part of this ADR.
