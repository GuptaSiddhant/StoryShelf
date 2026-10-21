# ADR 0010: Projects, Published Storybook and Labels

## Status

Accepted

Supersedes (archived): ADR 0011, 0013

## Context

A company may run several Storybooks across teams (a design system plus several apps), some in
monorepos. Three questions follow:

1. What does a "project" map to when a repository hosts more than one Storybook?
2. Does StoryShelf only show diff reviews, or does it also let non-engineers (designers, managers)
   browse the components, with or without visual testing turned on?
3. How do people find a build by a meaningful key (a pull request, an issue, a Figma file) and
   bookmark "the latest build for this key"?

Builds are addressed by ULID, which is unmemorable. Naming is also provider-specific: GitHub says pull
request, GitLab says merge request, one team tracks issues in Jira and another in Linear. A fixed
type enum forces the wrong vocabulary on some teams.

## Decision

### 1. A project is one Storybook, not one git repository

`projects.git_repository` is an optional link. Many projects may point at the same repository, so a
monorepo hosting several Storybooks becomes one project per Storybook. The CLI targets a project
explicitly through its project token, and each uploaded build is exactly one Storybook. Projects have a
unique, human-readable `slug` for shareable URLs (published Storybook, library, label pages).

Status checks do not carry the slug. A repository with several projects sets a distinct status prefix
per git channel (ADR 0014 Git Hosts and Notifications).

### 2. The published Storybook is a first-class surface

Every uploaded build carries a browsable Storybook, and StoryShelf publishes it.

- **Latest accepted build.** The project's published Storybook is the most recent accepted build whose
  branch is public. A build that is waiting for review is not the latest accepted build, so the
  project's Storybook link and upstream links keep resolving the previous accepted build until the
  waiting one is approved (ADR 0013 UI Review).
- **A build's own URLs always answer.** A build's page and its published Storybook by build id answer
  for anyone who may view the project, whatever the build's status. Status targets, pull-request
  comments and review notifications link to the build's own URL.
- **Public builds.** A build is public iff `builds.public = true` or `builds.git_branch` matches
  `projects.public_branch_regex` (for example `^main$`, `^release-`). Public builds are viewable
  without authentication. Every other Storybook requires authentication and at least `viewer`
  membership on the project. These access rules are the same with and without `testing`; hosting-only
  mode is not open access (ADR 0011 Authentication and Access).
- **Per-project subdomain.** Optionally served on a subdomain (`publishedBaseDomain` plus wildcard
  DNS and TLS), which serves the Storybook at the domain root with no asset rewriting. Subdomains are
  for sharing only; the review UI stays path-based on the main domain. The app builds those links but
  does not serve those hosts: whether a subdomain reaches the app depends on a proxy outside it.
- **Retention.** Published builds have no special retention and are purged like any other build.
  Because retention keeps the most recent build per branch, the latest public build on a branch
  survives purge; if it is purged, the published URL falls back to the next most recent public build,
  or answers 404 until a new build lands (ADR 0009 Baselines, Approval and Retention).

### 3. Token-authorised read route (signed Storybook URLs)

A remote browser that cannot reach the app's loopback static server is given a signed URL to a build's
published Storybook (ADR 0007 Remote Browsers and Public Origin). The token is a path prefix, because a
Storybook loads `iframe.html` and then many assets by relative path:

```
<publicOrigin>/s/<token>/projects/<slug>/storybook/build/<buildId>/iframe.html
```

- The app strips `/s/<token>`, verifies the token and serves the build's static files through the same
  file-serving branch as `/projects/:slug/storybook/build/:buildId/*`, as if `canViewBuild` had passed.
  It never serves the wrapper page that route returns for an empty path.
- The token is `base64url(projectId, buildId, expiresAt) + "." + HMAC-SHA256(key, same)`, verified
  statelessly. It grants read-only access to one build's static files and nothing else: no wrapper
  page, no API, no other build.
- The key is derived from `config.secret` with the fixed context string `storyshelf/storybook-url/v1`,
  so a token cannot be confused with a session or any other signature. During a rotation the token is
  also accepted if it verifies against `previousSecret`.
- Expiry is per job, default 2 hours (`testing.storybookUrlTtl`).
- The token is redacted from logs, attempt records and runner error messages.
- Subdomain published origins are not used for signed URLs, for the proxy reason above.
- Absolute links in the app (signed URLs, email links, status targets) are built from the public-origin
  resolver of ADR 0007, never from the `Host` or `X-Forwarded-Host` of a request.

### 4. Hosting-only is first class

Publishing does not depend on `testing` (ADR 0006 Testing Option, Hosting-Only Mode and the Database
Queue). With `testing` absent, uploads, published Storybooks, projects, tokens, members, labels, the
build pages and the library and component pages all work. What the published Storybook needs at publish
time:

- **File-by-file upload** (`/dedup`, `/content`, `/manifest`): files are already stored
  content-addressed, so publishing completes when the manifest is stored.
- **Zip upload:** a small zip is extracted inline in the request, with size counted while streaming. A
  larger zip is published by a `publish` job on the database queue, consumed by any instance on a
  long-running host with scratch space. On a host with no consumer, a zip over the inline limit is
  rejected at upload with a message pointing to the file-by-file route. `maxInlineUnzipSize` is the
  inline threshold and has a safe default.
- **Safety:** extraction enforces caps on entry count and total uncompressed bytes.
- **Acceptance:** a build on the default branch is accepted when publishing finishes, and so is any
  build when the project's `review` setting is off. A build on another branch with review on stays
  `pending` until reviewed. A build whose publishing fails becomes `failed`. An accepted build with no
  attempts is labelled "Published" in the UI.

### 5. The catalog: library, component and build pages from `index.json`

`index.json` is the primary data source of the library, component and build pages in both modes.
`testing` adds data to them; it does not change where their skeleton comes from.

- **Catalog data.** Publishing writes a compact catalog for the build (entry id, title, name, import
  path, type, tags) next to its statics, and one `build_components` row per component (project, build,
  import path, title, story count, a hash of the component's entries). The catalog serves the pages,
  cached in-process by build id. The table answers "which builds contain this component, and did it
  change" with one indexed query. Both are purged with the build. Builds published before the catalog
  existed are catalogued lazily on first view from their persisted statics.
- **Library.** Shows the latest build of the selected branch whatever its status: the default branch
  unless another is chosen in the branch switcher, falling back to the default branch's latest build
  and then to any build. Components are grouped by title, each linking to its component page and into
  the published Storybook (story and docs links), with tags and story counts. With `testing` it gains
  thumbnails, statuses, the health panel and design links.
- **Component page.** The published story as an iframe preview, the component's stories and docs
  entries, the project-level design links and previews (ADR 0018 Design Providers), and a build
  history: the builds the component appears in and whether its stories changed (added, removed, renamed
  or moved) since the build before. With `testing` it gains per-story snapshot status and diffs, history
  with statuses, moved-or-deleted detection and per-story design previews.
- **Build pages.** List and detail pages show sha, branch, author, message, size, labels, the link to
  the published Storybook, and component and story counts from the catalog. Snapshots, statuses and
  attempts appear only with `testing`. Build-level comments, verdicts and the changeset appear with
  review (ADR 0013).
- **Upstream links** resolve a build's stories from the catalog when there are no snapshots, so an
  accepted build with no snapshots still yields links.
- **Parameters are not in `index.json`.** Per-story design links and modes come only from a capture's
  `extractParameters`. Without `testing` the component page shows project-level design links only, and
  parameters that cannot be determined at build time are left empty; nothing treats the absence as an
  error.
- **Embedding the preview is a security decision.** Path-based serving puts a customer's Storybook
  JavaScript on the app's own origin. Opening the Storybook is an explicit action; embedding it in the
  library and component pages would run it on every visit. The embed therefore uses the separate
  published origin (`publishedBaseDomain`) when configured, and otherwise is click-to-load in a
  sandboxed iframe with a link out.

### 6. Labels with project-defined types

- `label_types`: `(project_id, key, name, link_template, color)`. `key` is the URL and CLI identifier
  (`branch`, `pr`, `mr`, `jira`, `linear`, `figma`, `custom`), `name` the display name, `link_template`
  the external URL pattern. `branch` and `persistent` are built-in seeded types; `persistent` is
  additionally non-removable (the API refuses to delete it).
- `build_labels`: `(build_id, type_key, value)`, one row per type and value. A build can carry several
  values of the same type (for example multiple git tags give multiple `persistent` labels).

**Link templates** turn a value into a clickable external URL, with `{value}`, `{repo}` and `{branch}`
resolved from the build:

- `pr`: `https://github.com/{repo}/pull/{value}`
- `mr`: `https://gitlab.com/{repo}/-/merge_requests/{value}`
- `jira`: `https://myorg.atlassian.net/browse/{value}`
- `linear`: `https://linear.app/myorg/issue/{value}`
- `figma`: `https://www.figma.com/file/{value}`

The review page renders label values as links.

**Attaching.** The CLI attaches labels at upload with `--label key=value` (repeatable). CI templates
populate `pr` (GitHub) or `mr` (GitLab) automatically; `jira`, `linear` and `figma` come from explicit
flags or branch and commit-message patterns. Unknown keys are auto-created as `custom` type, with no
link template, until configured.

**Persistent builds.** A build bearing any `persistent` label is exempt from auto-purge (ADR 0009). The
CLI detects git tags on the uploaded commit (`git tag --points-at <sha>`) and attaches one `persistent`
label per tag (value is the tag name, for example `v1.2.3`), so release builds survive retention
automatically.

**Search and resolution.**

- Filter builds with `GET /api/v1/projects/:id/builds?label=pr:123`.
- The label page `GET /projects/:slug/labels/:key/:value` lists every build bearing that label, latest
  first, with the external link: the bookmarkable "latest build for this PR or issue" page. It is an
  indexed query over `build_labels` joined to `builds`, with no denormalised pointer to keep consistent
  with purge. Values are URL-encoded and the `:value` segment is a wildcard, so branch names and tags
  with slashes (`feature/foo`, `release/v1.2`) round-trip exactly. Values are not slugified, which
  would collide.

## Consequences

**Positive**

- Designers and managers get a browsable component surface with no CI or code access, with or without
  testing infrastructure.
- Monorepos are supported without a special model (one project per Storybook).
- Public sharing is opt-in and scoped to specific builds and branches, so test builds stay private.
- Label types are configuration, not code: `pr` versus `mr` and Jira versus Linear need no release.
- Label values become actionable external links, and tagged builds persist automatically.
- Signed URLs let any remote browser load a private Storybook without exposing anything else.

**Negative**

- The latest public build can change as builds are purged; links to a purged build may 404.
- Public Storybooks need a robots and cache policy to avoid indexing test content.
- The signed-URL route is a new way to read a private Storybook from outside. It is narrow (one build,
  static files, short expiry) but needs its own security review.
- `label_types` is new configuration surface (project settings UI and seed defaults).
- Resolving the latest build for a label is a join, not an O(1) lookup, which is acceptable at
  self-hosted scale.
- `persistent` builds defeat retention bounds if overused; it is opt-in through git tags by design.
- The catalog and `build_components` add publish-time work and storage per build.

## Alternatives considered

- **One project per git repository.** Rejected: monorepos host several Storybooks.
- **A fixed label type enum.** Rejected: forces the wrong vocabulary on some teams.
- **Comma-separated tag strings.** Rejected: not queryable and has no link concept.
- **A denormalised "latest build per label" pointer.** Rejected: must stay consistent with purge.
- **Reading story parameters from the embedded preview in the viewer's browser.** Rejected: depends on
  Storybook's internal channel across versions 8 to 10.
- **Using the request `Host` to build absolute links.** Rejected: forgeable and absent in background
  jobs.

## Open questions

- Whether Storybook 8 to 10 previews run correctly in a sandboxed iframe without `allow-same-origin`,
  which settles the click-to-load embed.
- The size of the catalog and `build_components` on very large Storybooks, and whether component rows
  should store more than a hash.
- Whether extraction can stream straight into storage with no scratch disk, which would let a
  serverless host publish a zip too.
- How comments on a story survive when the story is renamed or removed between builds.
- Linked projects: design-system propagation records a `project_links` edge (downstream to upstream,
  per package) with provenance and deep links to the upstream published Storybook, rather than
  re-diffing dependents (issue #123).
- Label management polish (reorder, icons), label-based access control, label-driven webhook filters
  and syncing PR and MR labels from the git provider are deferred.
