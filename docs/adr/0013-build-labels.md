# ADR 0013: Build Labels (Project-Defined Types, Search + Link Templates + Stable URLs)

## Status

Accepted

## Context

Builds are addressed by ULID, which is unmemorable. Teams want to find builds by meaningful keys — a pull/merge request, a Jira/Linear issue, a Figma file — and to **refresh a URL and always land on the latest build** for that key (a manager bookmarking an issue; a dev hitting a PR/MR URL) rather than remembering a build id.

Two complications make a naive "tag" model wrong:

1. **Naming is provider-specific**: GitHub says PR, GitLab says MR; one team tracks issues in Jira, another in Linear. A fixed type enum (`branch|pr|jira|figma|custom`) forces the wrong vocabulary on some teams.
2. **Tags should link out**: a label value (`123`) is only useful if the UI can turn it into `https://github.com/org/repo/pull/123`. That mapping is per-type and per-provider.

StoryBooker stored tags as a comma-separated string (`tagIds: "a,b"`) with a fixed type enum and no link concept. The rewrite dropped it; this ADR re-introduces it properly.

## Decision

**Labels**, with **project-defined label types** and a per-build join.

- `label_types`: `(project_id, key, name, link_template, color)` — `key` is the URL/CLI identifier (`branch`, `pr`, `mr`, `jira`, `linear`, `figma`, `custom`), `name` the display name, `link_template` the external URL pattern. `branch` and `persistent` are built-in seeded types; `persistent` is additionally non-removable.
- `build_labels`: `(build_id, type_key, value)` — one row per type+value; a build can carry several values of the same type (e.g. multiple git tags → multiple `persistent` labels).

### Link templates

`link_template` turns a value into a clickable external URL, with `{value}`, `{repo}`, and `{branch}` resolved from the build:

- `pr` → `https://github.com/{repo}/pull/{value}`
- `mr` → `https://gitlab.com/{repo}/-/merge_requests/{value}`
- `jira` → `https://myorg.atlassian.net/browse/{value}`
- `linear` → `https://linear.app/myorg/issue/{value}`
- `figma` → `https://www.figma.com/file/{value}`

The review page renders label values as links.

### Attaching labels

The CLI attaches labels at upload: `--label key=value` (repeatable). CI templates populate `pr` (GitHub) or `mr` (GitLab) automatically; `jira`/`linear`/`figma` come from explicit flags or branch/commit-message patterns. Unknown keys are auto-created as `custom` type (no link template) until configured.

### Persistent builds

`persistent` is a built-in, non-removable label type (seeded on every project; the API refuses to delete it). A build bearing any `persistent` label is **exempt from auto-purge** (ADR 0009). The CLI detects git tags on the uploaded commit (`git tag --points-at <sha>`) and attaches one `persistent` label per tag (value = tag name, e.g. `v1.2.3`), so release/tag builds survive retention automatically.

### Search & resolution

- Filter builds: `GET /api/v1/projects/:id/builds?label=pr:123`.
- **Label page (stable URL):** `GET /projects/:slug/labels/:key/:value` lists every build bearing that label, latest first, with the external link — the bookmarkable "latest build for this PR/issue" page. Resolved by an indexed query over `build_labels` joined to `builds` — no denormalised pointer to keep consistent with purge. Values are URL-encoded and the `:value` segment is a wildcard, so branch names and git tags with slashes (`feature/foo`, `release/v1.2`) round-trip exactly; values are not slugified, which would collide.

## Consequences

**Positive:**
- Provider-agnostic: `pr` vs `mr`, Jira vs Linear are config, not code
- Label values become actionable external links
- First-class and queryable (unlike StoryBooker's comma-string); no denormalised state to maintain
- Release/tag builds persist automatically via the built-in `persistent` label

**Negative:**
- `label_types` is new configuration surface (project settings UI + seed defaults)
- Resolving "latest build for a label" is a join query rather than an O(1) lookup (acceptable at self-hosted scale; can denormalise later if needed)
- A `branch` label type is available for uniform search but is redundant with `builds.git_branch`; teams that don't want it can delete the type
- `persistent` builds defeat retention bounds if overused (e.g. tagging every commit); it's opt-in via git tags by design

## Deferred (v2)

Label management UI polish (reorder, icons), label-based access control, label-driven webhook filters, and auto-syncing PR/MR labels from the Git provider.
