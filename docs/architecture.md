# StoryShelf Architecture

## What StoryShelf Is

A self-hosted visual testing platform for Storybook. Run visual regression tests in CI, review pixel-level diffs in a web UI, and approve changes before they ship. No per-snapshot billing. No vendor lock-in.

**One-liner:** "Self-hosted Chromatic alternative. Storybook-native. Unlimited snapshots."

## Product Workflow

```
Developer pushes code
  → CI runs: npx @storyshelf/cli upload --token=xxx
  → CLI builds Storybook (if needed), zips the static build
  → CLI uploads the zip + metadata (sha, branch, message, author) to StoryShelf server
  → Server creates a build, stores the zip, and enqueues capture (async, returns 202)
  → Capture worker: unzip → serve statics → render every story via Playwright
  → Server runs pixel diff against per-branch baselines (fallback to default branch)
  → Default-branch builds auto-approve and become the new baselines
  → PR gets a status check linking to the review UI
  → Reviewer opens review page, sees diff overlays
  → Reviewer accepts/rejects changed stories
  → Accepted stories become that branch's baselines
  → PR can merge; the next default-branch build re-baselines everything
```

## Entity Model

All IDs are ULIDs. All timestamps are ISO-8601.

```sql
projects (
  id                  text PRIMARY KEY,        -- one project = one Storybook (not one git repo)
  name                text NOT NULL,
  slug                text NOT NULL UNIQUE,    -- URL-safe, human-readable; used in all HTML/public URLs
  git_repository      text,                    -- "owner/repo" (optional link; many projects may share a repo)
  git_default_branch  text NOT NULL DEFAULT 'main',
  pixel_threshold     real NOT NULL DEFAULT 0.1,    -- per-pixel color distance (0-1)
  max_diff_ratio      real NOT NULL DEFAULT 0.01,   -- max allowed diff ratio (0-1)
  public_branch_regex text,                    -- branches whose builds are publicly viewable (ADR 0011)
  created_at          text NOT NULL,
  updated_at          text NOT NULL
);

builds (
  id                  text PRIMARY KEY,        -- ULID (NOT git SHA: allows re-runs)
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  git_sha             text NOT NULL,
  git_branch          text NOT NULL,
  is_default          boolean NOT NULL DEFAULT false,  -- git_branch == project.git_default_branch at capture time
  author_email        text,
  author_name         text,
  message             text,
  public              boolean NOT NULL DEFAULT false,  -- individual build override for public viewing
  status              text NOT NULL DEFAULT 'pending',  -- pending|capturing|comparing|reviewing|approved|rejected|failed
  snapshot_count      integer NOT NULL DEFAULT 0,
  changed_count       integer NOT NULL DEFAULT 0,
  approved_count      integer NOT NULL DEFAULT 0,
  rejected_count      integer NOT NULL DEFAULT 0,
  created_at          text NOT NULL,
  updated_at          text NOT NULL
);

-- One row per story x viewport per build
snapshots (
  id                  text PRIMARY KEY,
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id            text NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  story_id            text NOT NULL,           -- "components-button--primary"
  story_name          text NOT NULL,           -- "Primary"
  story_title         text NOT NULL,           -- "Components/Button"
  story_import_path   text,                    -- "src/components/Button.stories.tsx"
  viewport_name       text NOT NULL DEFAULT 'desktop',
  viewport_width      integer NOT NULL DEFAULT 1280,
  viewport_height     integer NOT NULL DEFAULT 720,
  screenshot_path     text NOT NULL,           -- storage path to current screenshot
  diff_path           text,                    -- storage path to diff overlay image
  diff_pixels         integer,                 -- number of differing pixels
  diff_ratio          real,                    -- diff_pixels / total_pixels
  diff_passed         boolean,                 -- true if within threshold
  status              text NOT NULL DEFAULT 'pending',  -- pending|new|unchanged|changed|approved|rejected
  reviewed_by         text,
  reviewed_at         text,
  created_at          text NOT NULL,
  updated_at          text NOT NULL,
  UNIQUE(build_id, story_id, viewport_name)
);

-- Baseline pointers: the accepted screenshot for a story on a branch
baselines (
  id                  text PRIMARY KEY,
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  story_id            text NOT NULL,
  viewport_name       text NOT NULL DEFAULT 'desktop',
  branch              text NOT NULL,           -- "main", "feature/xyz"
  snapshot_id         text,                    -- accepted snapshot (informational; may be purged)
  screenshot_path     text NOT NULL,           -- canonical baseline file (independent of builds)
  created_at          text NOT NULL,
  updated_at          text NOT NULL,
  UNIQUE(project_id, story_id, viewport_name, branch)
);

-- Review comments (threaded, on a build or a specific snapshot)
comments (
  id                  text PRIMARY KEY,
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id            text NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  snapshot_id         text REFERENCES snapshots(id) ON DELETE CASCADE,  -- NULL = build-level comment
  user_id             text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body                text NOT NULL,
  parent_id           text REFERENCES comments(id) ON DELETE CASCADE,   -- NULL = top-level, else reply
  resolved            boolean NOT NULL DEFAULT false,                   -- feedback addressed
  created_at          text NOT NULL,
  updated_at          text NOT NULL
);

-- Label types: project-defined kinds of build labels (with external link templates).
-- `persistent` is a built-in, non-removable type: builds bearing it are exempt from purge.
label_types (
  id            text PRIMARY KEY,        -- ULID
  project_id    text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key           text NOT NULL,           -- "branch", "persistent", "pr", "mr", "jira", "linear", "figma", "custom"
  name          text NOT NULL,           -- display name: "Persistent", "Pull request", "Jira issue"
  link_template text,                    -- external URL, e.g. "https://github.com/{repo}/pull/{value}"
  color         text,                    -- optional UI color
  created_at    text NOT NULL,
  UNIQUE(project_id, key)
);

-- Build labels: typed values attached to a build (one row per type+value; a build can carry
-- several values of the same type, e.g. multiple git tags -> multiple `persistent` labels)
build_labels (
  id          text PRIMARY KEY,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id    text NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  type_key    text NOT NULL,             -- references label_types.key
  value       text NOT NULL,             -- "123", "ABC-123", "v1.2.3"
  created_at  text NOT NULL,
  UNIQUE(build_id, type_key, value)
);

tokens (
  id                  text PRIMARY KEY,
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                text NOT NULL,           -- display name
  hash                text NOT NULL UNIQUE,    -- hashed token value
  last_used_at        text,
  created_at          text NOT NULL
);

webhooks (
  id                  text PRIMARY KEY,
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url                 text NOT NULL,
  secret              text NOT NULL,           -- HMAC secret, encrypted at rest
  events              text,                    -- JSON array or NULL for all
  created_at          text NOT NULL,
  updated_at          text NOT NULL
);

-- Users (created by auth adapter on login, optional if no auth configured)
users (
  id                  text PRIMARY KEY,        -- from auth provider (e.g., GitHub user ID)
  email               text NOT NULL UNIQUE,
  name                text NOT NULL,
  avatar_url          text,
  role                text NOT NULL DEFAULT 'member',  -- 'admin' (site-wide) | 'member' (access via project_members)
  last_login_at       text,
  created_at          text NOT NULL
);

-- Project-scoped authorization: a user's role on a specific project
project_members (
  id                  text PRIMARY KEY,
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id             text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                text NOT NULL DEFAULT 'viewer',  -- admin|approver|developer|viewer
  created_at          text NOT NULL,
  UNIQUE(project_id, user_id)
);
```

### Key Relationships

```
Project 1--* Build 1--* Snapshot
Project 1--* Baseline (per branch)
Project 1--* LabelType
Build   1--* BuildLabel *--1 LabelType
Project 1--* Token
Project 1--* Webhook
Project 1--* ProjectMember *--1 User   (project-scoped roles)
```

- **Build to Snapshot:** one build contains many snapshots (one per story x viewport)
- **Baseline (table):** a pointer `(project, story, viewport, branch)` → the accepted screenshot file. The **file** (`screenshot_path`) is canonical; builds are transient and can be purged without losing baselines.
- **Accept:** copy the accepted snapshot's screenshot to the baseline path, upsert the `baselines` row for that branch.
- **Reject:** mark the snapshot rejected, no baseline change.
- **Access control:** a user's permissions on a project come from `project_members` (project-scoped role); `users.role = 'admin'` is a site-wide admin bypass (ADR 0008).
- **Label:** a typed value (`pr=123`, `jira=ABC-123`) attached to a build. Types are project-defined (`label_types`) and carry external link templates; the latest build for a `(key, value)` is resolved by query over `build_labels` joined to `builds`.

## Storage Layout

```
data/                                    # --data-dir flag (default: ./data)
  {projectId}/
    builds/
      {buildId}/
        screenshots/
          {storyId}/{viewport}.png       # captured screenshots (transient, TTL'd)
        diffs/
          {storyId}/{viewport}.png       # generated diff overlay (transient, TTL'd)
        storybook/                       # extracted Storybook static build (served for capture + preview)
          index.json
          static/
    baselines/
      {branch}/
        {storyId}/{viewport}.png         # canonical approved screenshot (NEVER TTL'd)
```

**Design decisions:**
- **Local filesystem is the default.** One `docker run` to self-host. No cloud accounts needed.
- **S3-compatible storage is an alternative.** MinIO for self-hosted S3. Cloudflare R2, AWS S3, DigitalOcean Spaces for cloud. Same adapter interface, two implementations.
- **No "container" abstraction.** Just paths. Storage adapter is `read/write/delete/exists/list` over a flat path namespace.
- **Baselines stored separately from builds, under their own branch.** Baselines are the "truth" — builds are transient, baselines persist.

## Capture Pipeline (Server-Side Render)

The CLI does **not** run Playwright. It builds Storybook (or reuses an existing build), zips the static output, and uploads it. The server renders stories in its own pinned Playwright environment. This keeps rendering deterministic (server controls the browser version) without cloning the repository on the server.

```
CI machine / local dev                  StoryShelf server
---------------------                  -----------------
1. storyshelf upload
2. build Storybook (optional)
3. zip static build           ------->  4. store zip, create build (status=pending)
                                        5. enqueue capture (async, 202 returned)
                                        6. worker: unzip -> serve statics
                                        7. worker: Playwright renders each story x viewport
                                        8. worker: diff against baselines
                                        9. worker: update build/snapshot statuses
```

### Capture Runner

```typescript
interface CaptureRunner {
  /** Run the capture pipeline for a build (discover -> serve -> render -> diff -> store). */
  run(buildId: string): Promise<void>;
  /** Cancel a running capture. */
  cancel(buildId: string): Promise<void>;
}
```

One local implementation in v1 — `@storyshelf/runner-playwright` (the server already has Playwright via the base image). The interface is kept thin so v2 can add a **remote** runner (offload capture to a worker fleet via a queue) without changing the pipeline — a future `@storyshelf/runner-remote` plugs in at the `serve` assembly point the same way.

### Capture Queue

Capture is CPU/IO-heavy and long-running (minutes to tens of minutes). It must not block the upload request:

- `POST /builds` stores the zip and returns **202 Accepted** immediately.
- An in-process queue with a **configurable concurrency** (`--capture-concurrency`, default `2`) runs captures.
- A build stuck in `capturing` across a server restart is detected and re-queued (or marked `failed`).

### Story Source Adapter

```typescript
interface StorySourceAdapter {
  name: string;
  discover(source: string): Promise<StoryEntry[]>;
  buildUrl(baseUrl: string, storyId: string): string;
  screenshotSelector?: string;  // default: "#storybook-root"
  waitForReady?(page: Page): Promise<void>;
}

interface StoryEntry {
  id: string;
  title: string;
  name: string;
  importPath?: string;
  tags?: string[];
  type: "story" | "docs";
}
```

Only the Storybook adapter exists in v1. Ladle uses the same CSF format (one-day addition). Histoire uses a different format (v2, when stable).

### Capture Flow

```typescript
async function capture(buildId: string): Promise<void> {
  // 1. Unzip the uploaded Storybook build into storage
  const storybookDir = await extractStorybook(buildId);

  // 2. Serve it over HTTP (Storybook needs an origin to fetch JS/assets)
  const server = await serveStatic(storybookDir);   // http://127.0.0.1:<port>

  // 3. Discover stories from index.json
  const stories = await storybookAdapter.discover(storybookDir);

  // 4. Launch Playwright
  const browser = await chromium.launch();

  // 5. For each story x viewport: render + screenshot
  for (const viewport of options.viewports) {
    for (const story of stories) {
      const page = await browser.newPage({ viewport });
      const url = storybookAdapter.buildUrl(server.origin, story.id);
      await page.goto(url);
      await storybookAdapter.waitForReady?.(page);
      const buffer = await page.locator("#storybook-root").screenshot({ animations: "disabled" });
      await storeScreenshot(buildId, story, viewport, buffer);
    }
  }

  // 6. Diff each screenshot against its baseline (see "Baseline Resolution")
  await runDiffs(buildId);
}
```

### Deterministic Rendering

Rendering happens on the server against the user's uploaded static build, in a pinned browser:

1. **Pinned Playwright image** -- same browser version everywhere (`mcr.microsoft.com/playwright:<pinned>`)
2. **Disable animations** -- CSS injection: `* { animation: none !important; transition: none !important; }`
3. **Wait for network idle** -- `page.waitForLoadState("networkidle")`
4. **Freeze time** (optional) -- inject a fixed `Date` via `page.addInitScript`
5. **Embed fonts** (optional) -- ensure same font files in the capture image

## Baseline Resolution & Review Workflow

### Resolution (per-branch with fallback to default)

For a snapshot of `(story, viewport)` in a build on branch `B`:

1. Look up `baselines(project, story, viewport, branch=B)`. If found, diff against it.
2. Otherwise, fall back to `baselines(project, story, viewport, branch=default)`.
3. If neither exists (a brand-new story):
   - On the **default branch**: auto-approve and write the baseline.
   - On a **feature branch**: mark `new` (needs review).

This is what "per-branch acceptance with fallback to default" means: accepting a change on a feature branch writes a baseline **for that branch**, so subsequent commits on the same branch diff against the accepted version instead of re-flagging the same change against an untouched default branch.

### Workflow

1. **Build created** -- status `pending`, snapshots not yet captured
2. **Capture + diff run (async)** -- each snapshot becomes:
   - `unchanged` (within threshold, auto-approved) or
   - `new` (no baseline, feature branch) or
   - `changed` (exceeds threshold)
3. **Reviewer opens build page** -- sees `new`/`changed` stories with diff overlays
4. **Reviewer accepts** -- snapshot `approved`; that branch's baseline updated
5. **Reviewer rejects** -- snapshot `rejected`; no baseline change
6. **All changed stories resolved** -- build status `approved` or `rejected`
7. **Merge to default** -- the next default-branch build re-captures and auto-approves, re-baselining the project

### Review Comments

Reviewers and developers can leave **threaded comments** on any snapshot (or on the build as a whole), and mark threads **resolved** once addressed. A comment on an unresolved snapshot keeps it in `changed` until the author pushes a fix and it is re-approved — this is the "request changes" flow. Comments persist on the build until the build is purged.

### PR Status Checks & Merge Gate

A status adapter (GitHub/GitLab) sets commit statuses on the `git_sha`:
- `pending` when the build is created
- `success` when all `new`/`changed` stories are approved
- `failure` when changes are rejected or remain unresolved

The point of the status is to **block the merge**: the repo owner marks StoryShelf's status as a *required check* in GitHub branch protection (or a required pipeline/approval rule in GitLab), so a PR cannot merge until StoryShelf reports `success`. This is the v1 primitive.

Because a repo may host several projects (one per Storybook), each project posts its status under a distinct context (`storyshelf/<project-name>`), so multiple Storybooks on the same commit don't collide.

The full merge-gate story is v2 (ADR 0010): a GitHub App / GitLab integration that posts rich check runs (per-snapshot annotations deep-linking to the diff), authenticates via a repo-installed App rather than a project token, and can auto-reject the PR when the build is rejected.

## Pixel Diff Engine

```typescript
interface DiffOptions {
  pixelThreshold: number;      // 0-1, per-pixel color distance (default: 0.1)
  maxDiffRatio: number;        // 0-1, max allowed diff ratio (default: 0.01)
  includeAntialiasing: boolean;
  failOnSizeChange: boolean;
}

interface DiffResult {
  passed: boolean;
  diffPixels: number;
  diffRatio: number;
  diffImage: Buffer;           // PNG overlay showing changed pixels in red
  baselineDimensions: { width: number; height: number };
  currentDimensions: { width: number; height: number };
  sizeChanged: boolean;
}
```

Uses `pixelmatch` for pixel comparison and `pngjs` for PNG manipulation.

### Diff Overlay

The diff image is an overlay where:
- Unchanged pixels are shown at 50% opacity
- Changed pixels are highlighted in red
- This gives a visual "heat map" of what changed

Thresholds are configurable per-project (`pixel_threshold`, `max_diff_ratio`) and overridable per-run via the CLI.

## Retention & Purge

Screenshots accumulate fast. Everything below the **baseline** is transient; the baseline is the truth.

### What is never purged

- `baselines/**` files and `baselines` rows (all branches)
- Builds bearing a `persistent` label (release/tag builds) and their storage files

### What is purged

- **Builds in a terminal review state** (`approved`/`rejected`) older than `purge_ttl` (default 30 days).
- **Old builds of a branch**: retain the most recent build per branch (it is the branch's "current" state and powers the PR status link); purge older ones past TTL.
- Builds stuck in non-terminal states are **not** purged (a `reviewing` build must not vanish before review).

Purge removes **both** storage files (`builds/{buildId}/`) and database rows (`builds`, `snapshots`) in one transaction.

### Orphaned baselines

When a story is renamed or removed from Storybook, its baseline is never touched by normal builds. On each **default-branch** build, diff `index.json` against the `baselines` table and delete baselines whose `story_id` no longer exists.

### Trigger

- **Scheduled**: an in-server timer driven by `--purge-interval` (default hourly).
- **Manual**: `storyshelf purge` CLI command or `POST /api/v1/admin/purge` (admin).

## Published Storybook

Beyond diff review, StoryShelf publishes the uploaded Storybook build as a browsable site, so designers and managers can look at components without touching CI or code.

- Each build's `storybook/{buildId}/` statics are served as the browsable Storybook.
- The **published** Storybook for a project is the most recent build whose branch is public. A build is public iff `builds.public = true` or `builds.git_branch` matches `projects.public_branch_regex` (e.g. `^main$`, `^release-`).
- **Access control:** a public build is viewable **without auth**. Every other Storybook requires auth and at least `viewer` membership on the project (ADR 0008).
- **Retention:** published builds follow the same purge rules as any other build. Because retention keeps the most recent build per branch, the latest public build on a branch survives purge; if it is purged, the published URL falls back to the next-most-recent public build (or 404 until a new build lands).

### URL structure

A published Storybook is addressed by **build** or **label** (`build` is a reserved segment, not a valid label key):

- `GET /projects/:slug/storybook`                      latest published on the default branch
- `GET /projects/:slug/storybook/:key/:value`          latest build bearing that label (`:value` is a wildcard; values are URL-encoded)
- `GET /projects/:slug/storybook/build/:buildId/...`   a specific build — the canonical path that serves assets

`/storybook` and `/storybook/:key/:value` are **resolvers** that 302-redirect to `/storybook/build/<id>/`; Storybook files (`iframe.html`, `index.json`, `assets/*.js`, `sb-manager/*`, …) are served only under `/storybook/build/:buildId/...`. This keeps label resolution from colliding with static-file serving — Storybook emits nested paths like `assets/foo.js` that are otherwise indistinguishable from a `key/value` label. The public/auth check from ADR 0011 applies to all three.

### Subdomains (optional)

For sharing, a published Storybook can also be served on a **per-project subdomain** — opt-in via `publishedBaseDomain` (e.g. `stories.example.com`) plus a wildcard DNS record (`*.stories.example.com`) and a wildcard TLS cert:

- `:slug.stories.example.com`          → latest published Storybook on the default branch
- `:buildId.:slug.stories.example.com` → a specific build

Subdomains serve the Storybook at the domain **root**, so no asset-path rewriting is needed (Storybook's static build expects root serving). They serve **published Storybooks only** — the review UI stays on the main domain at `/projects/:slug/...`. Label values are not exposed as subdomains (DNS labels cannot contain `/`); labels remain on the path-based URLs above. Without `publishedBaseDomain`, the path-based URLs are the only published surface (and stay the default for `localhost` and hosts without a wildcard record). The `linkRoute()` builder switches between path and subdomain forms based on config.

## Build Labels

Builds carry **labels** — typed values that identify related builds and link out to external systems. Labels drive search and stable, refreshable URLs: a manager can bookmark a Jira issue; a dev can refresh a PR/MR label to always see the latest build.

- **Types are project-defined** (`label_types`). Each project configures the kinds it uses — a GitHub team defines `pr`, a GitLab team `mr`, and either adds `jira`, `linear`, `figma`, `custom`. A type has a `key`, a display `name`, an optional `color`, and a **`link_template`** that turns a value into an external URL (`{repo}` and `{branch}` resolve from the build):
  - `pr` → `https://github.com/{repo}/pull/{value}`
  - `mr` → `https://gitlab.com/{repo}/-/merge_requests/{value}`
  - `jira` → `https://myorg.atlassian.net/browse/{value}`
  - `linear` → `https://linear.app/myorg/issue/{value}`
  - `figma` → `https://www.figma.com/file/{value}`
  The review page renders label values as clickable links.
- **Attached at upload time.** The CLI attaches labels via `--label key=value` (repeatable), and always attaches `branch=<git_branch>` (a seeded label type). CI templates populate `pr` (GitHub) or `mr` (GitLab) automatically, and `jira`/`linear`/`figma` from explicit flags or branch/commit-message patterns. Unknown keys are auto-created as `custom` type.
- **Persistent builds.** `persistent` is a built-in, **non-removable** label type: a build bearing it is never purged. The CLI detects git tags on the uploaded commit (`git tag --points-at <sha>`) and attaches one `persistent` label per tag (value = tag name, e.g. `v1.2.3`), so release/tag builds survive retention automatically.
- **Search:** `GET /builds?label=pr:123`.
- **URL-safe values.** Label values (branch names, git tags) may contain slashes and special characters. In URLs, values are encoded with `encodeURI` and the value route segment is a wildcard that captures slashes, so `branch=feature/foo` round-trips as `…/labels/branch/feature/foo`. Values are deliberately **not** slugified — slugifying would collide (`feature/foo` vs `feature-foo`).
- **Label page:** `GET /projects/:slug/labels/:key/:value` lists every build bearing that label (latest first) with the external link — a bookmarkable "latest build for this PR/issue" page. Resolved by an indexed query over `build_labels` joined to `builds` (no denormalised pointer to keep in sync).

## API Design

All JSON endpoints under `/api/v1`. HTML pages at `/`. HTML and published-Storybook routes address projects by their `slug`; JSON endpoints use the ULID `id`.

```
# Projects
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:projectId
PATCH  /api/v1/projects/:projectId
DELETE /api/v1/projects/:projectId

# Builds
GET    /api/v1/projects/:projectId/builds
POST   /api/v1/projects/:projectId/builds          # multipart: storybook zip + sha/branch/message/author -> 202
GET    /api/v1/projects/:projectId/builds/:buildId
POST   /api/v1/projects/:projectId/builds/:buildId/retry   # re-run capture (flaky tests)
DELETE /api/v1/projects/:projectId/builds/:buildId

# Snapshots (read-only API, mutations via review endpoints)
GET    /api/v1/projects/:projectId/builds/:buildId/snapshots

# Review
POST   /api/v1/projects/:projectId/builds/:buildId/snapshots/:snapshotId/approve
POST   /api/v1/projects/:projectId/builds/:buildId/snapshots/:snapshotId/reject
POST   /api/v1/projects/:projectId/builds/:buildId/approve-all
POST   /api/v1/projects/:projectId/builds/:buildId/reject-all

# Comments
GET    /api/v1/projects/:projectId/builds/:buildId/comments
POST   /api/v1/projects/:projectId/builds/:buildId/comments         # { body, snapshotId?, parentId? }
POST   /api/v1/projects/:projectId/builds/:buildId/comments/:commentId/resolve

# Labels
GET    /api/v1/projects/:projectId/label-types                      # list label types
POST   /api/v1/projects/:projectId/label-types                      # create type { key, name, linkTemplate, color }
PATCH  /api/v1/projects/:projectId/label-types/:key
DELETE /api/v1/projects/:projectId/label-types/:key
GET    /api/v1/projects/:projectId/builds?label=:key::value         # filter builds by label

# Tokens
GET    /api/v1/projects/:projectId/tokens
POST   /api/v1/projects/:projectId/tokens
DELETE /api/v1/projects/:projectId/tokens/:tokenId

# Members (project-scoped RBAC; project admin or site admin)
GET    /api/v1/projects/:projectId/members
POST   /api/v1/projects/:projectId/members          # { userId, role }
PATCH  /api/v1/projects/:projectId/members/:userId  # change role
DELETE /api/v1/projects/:projectId/members/:userId

# Publishing
POST   /api/v1/projects/:projectId/builds/:buildId/publish     # mark build publicly viewable
POST   /api/v1/projects/:projectId/builds/:buildId/unpublish

# Admin
POST   /api/v1/admin/purge                          # manual retention purge

# Auth (session-based, web UI)
GET    /auth/login                     # redirect to OAuth provider
GET    /auth/callback                  # handle OAuth callback
POST   /auth/logout                    # destroy session

# UI Pages
GET    /                                                   # projects list
GET    /projects/create
POST   /projects/create
GET    /projects/:slug                                    # project overview (recent builds, labels)
GET    /projects/:slug/builds                             # builds list (filter by branch/status/label)
GET    /projects/:slug/builds/:buildId                    # build review page (diff + comments + labels)
GET    /projects/:slug/labels                             # label types (config)
GET    /projects/:slug/labels/:key/:value                 # label page (`:value` wildcard, URL-encoded)
GET    /projects/:slug/storybook                          # published Storybook (default branch)
GET    /projects/:slug/storybook/:key/:value              # published Storybook (`:value` wildcard, URL-encoded)
GET    /projects/:slug/storybook/build/:buildId/...       # published Storybook (specific build; serves assets)
GET    /projects/:slug/settings                           # members, label types, public access, tokens, webhooks
```

## Package Structure

```
StoryShelf/
  packages/
    core/
      src/
        models/           # schema + business logic
          project.ts
          build.ts
          snapshot.ts
          baseline.ts
          member.ts
          comment.ts
          label.ts
          token.ts
          webhook.ts
        routers/          # API + UI routes
          projects.ts
          builds.ts
          snapshots.ts
          review.ts
          comments.ts
          labels.ts
          tokens.ts
          webhooks.ts
          members.ts
          admin.ts
          pages/          # UI page components
            projects-list.tsx
            project-create.tsx
            project-details.tsx
            project-settings.tsx
            build-list.tsx
            build-review.tsx    # the review page (diff overlays + comment threads + labels)
            labels.tsx          # label types config
            label-details.tsx   # label page (external link + build history)
            storybook.tsx       # published Storybook (browsable by designers/managers)
            members.tsx         # project members management
        adapters/         # interfaces only
          database.ts
          storage.ts
          auth.ts
          status.ts       # GitHub/GitLab status checks
          capture-runner.ts
          logger.ts
        capture/          # server-side capture pipeline
          adapter.ts      # StorySourceAdapter interface
          storybook.ts    # Storybook adapter (index.json discovery)
          serve.ts        # serve extracted statics for capture
          pipeline.ts     # render -> screenshot -> store -> diff
          queue.ts        # in-process queue + concurrency
        diff/             # visual diff engine
          engine.ts       # pixelmatch + overlay generation
          options.ts      # DiffOptions, DiffResult types
        retention/        # purge
          purge.ts        # TTL + per-branch retention + orphan GC
        ui/               # fixed server-rendered UI (hono/jsx + HTMX + hono/css)
          document.tsx    # DocumentLayout: head, vendored HTMX, styles
          theme.ts        # light/dark color tokens (BrandTheme)
          brand.ts        # name/logo/favicon from the ui config
          scripts/        # vanilla JS: theme toggle, keyboard review
        urls.ts           # type-safe URL builder
        store.ts          # AsyncLocalStorage context
        config.ts         # RouterConfig
        index.ts          # createShelfRouter entry point
      package.json

    db-sqlite/
      src/
        database.ts       # DatabaseAdapter for SQLite (via better-sqlite3 + Drizzle)
        migrate.ts        # Migration runner
      package.json

    db-turso/
      src/
        database.ts       # DatabaseAdapter for Turso/libSQL (via @libsql/client + Drizzle)
        migrate.ts        # Migration runner
      package.json

    storage-local/
      src/
        filesystem.ts     # StorageAdapter for local filesystem
      package.json

    storage-s3/
      src/
        s3.ts             # StorageAdapter for S3-compatible (AWS S3, R2, MinIO)
      package.json

    auth-oauth/
      src/
        oauth.ts          # AuthAdapter for OAuth/OIDC (GitHub, GitLab, Keycloak, etc.)
      package.json

    auth-password/
      src/
        password.ts       # AuthAdapter: shared password via env var
      package.json

    cli/
      src/
        index.ts          # CLI client entry (commander: upload/init/retry/purge, no Playwright)
        commands/
          upload.ts       # storyshelf upload (build Storybook -> zip -> upload; git tags -> persistent label)
          retry.ts        # storyshelf retry (re-run capture for a build)
          init.ts         # storyshelf init (create project, generate token)
          purge.ts        # storyshelf purge (manual retention purge)
      package.json

    server/
      src/
        index.ts          # server entry (commander: `serve`, the default command)
        commands/
          serve.ts        # storyshelf-server serve (assemble router + adapters + runner, listen)
      package.json

    runner-playwright/
      src/
        index.ts          # CaptureRunner entry
        capture-runner.ts # Playwright CaptureRunner (unzip -> static server -> render -> store)
        static-server.ts  # local HTTP server for the extracted Storybook during capture
        viewport.ts       # default viewports
      package.json
```

## Tech Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| **Runtime** | Node.js 22+ | Playwright's best-supported runtime; LTS |
| **HTTP framework** | Hono (OpenAPIHono) | Type-safe routes, OpenAPI spec generation, edge-compatible |
| **Database** | SQLite via `better-sqlite3` + Drizzle ORM (local). Turso/libSQL via `@libsql/client` + Drizzle (serverless). | Zero-config on VPS/Docker. Turso for Vercel/Cloudflare Workers. Same schema, same queries, different connection. |
| **Storage** | Local filesystem (default). S3-compatible (R2, MinIO, S3) as alternative. | Local for Docker/VPS. S3 for cloud. Same adapter interface, two implementations. |
| **Screenshot capture** | Playwright (server-side) | Industry standard. Deterministic rendering in a pinned image. `toHaveScreenshot` battle-tested |
| **Pixel diff** | pixelmatch + pngjs | Same libraries Playwright uses internally. Fast, reliable, widely adopted |
| **Server UI** | hono/jsx + HTMX + hono/css | Server-rendered, fixed UI with brand theming; no client framework or build step |
| **Capture queue** | In-process queue + concurrency limit | v1 has no external queue dependency; interface allows remote runners in v2 |
| **Linting** | oxlint + oxfmt | Fast, strict, Rust-based. Same as StoryBooker |
| **Testing** | vitest | Fast, TypeScript-native, ESM-first |
| **Bundler** | tsdown | Fast, simple, ESM output. Same as StoryBooker |
| **Task runner** | turbo | Monorepo build orchestration. Same as StoryBooker |
| **Package manager** | nub/nubx | Proven in StoryBooker. Monorepo-aware, works with turbo |
| **CLI framework** | commander.js | Lightweight, well-typed, no magic |
| **Auth** | Pluggable AuthAdapter. Built-in: OAuth/OIDC, shared password. No auth by default. | Enterprise teams plug in their IdP (Keycloak, Authentik, Okta, GitHub). CLI uses API tokens (separate from user auth). |
| **Schema validation** | zod | Runtime validation for API inputs. Drizzle uses it for schema |
| **Date/time** | Built-in `Date` + ISO strings | No luxury date library needed |
| **IDs** | ULID | Sortable, collision-resistant, URL-safe |

### What Changed from StoryBooker

| StoryBooker | StoryShelf | Why |
|-------------|-----------|-----|
| Capture = upload pre-captured screenshots | Capture = upload Storybook build, server renders | Deterministic rendering without cloning repos |
| No ORM (raw adapter calls) | Drizzle ORM | Type-safe schema, migrations, query builder |
| LocalFileDatabase (JSON) | SQLite + Turso | ACID on VPS/Docker. Turso for serverless |
| AsyncLocalStorage for models | Constructor injection | Models take adapters as constructor args |
| 7 compute adapters (5 untested) | 1 CaptureRunner + in-process queue | Capture is a fixed pipeline, not user-defined jobs |
| Build ID = git SHA | ULID + `git_sha` column | Re-runs, squash/merge-safe |
| Stringified DynamoDB values | SQLite native types | Proper booleans, numbers, JSON columns |
| Per-project S3 buckets | Local filesystem + S3 option | Local default. S3-compatible for cloud |
| 1 project = 1 repo | 1 project = 1 Storybook (many per repo) | Monorepos with multiple Storybooks |
| 4 fixed variants (storybook, testReport, coverage, screenshots) | Snapshots table (per story x viewport) | Per-story tracking for visual testing |
| `tagIds: "a,b"` comma-separated | Project-defined label types + `build_labels` join | Typed, configurable, link templates, stable-URL resolution |
| `compute.jobs[]` nested in Project | No jobs table in v1 | Capture is a fixed pipeline |
| `latestBuildId` on Project | `baselines` per branch | Baseline is per branch, not per project |
| Dual-mode HTML/JSON routes | Separate `/api/v1` and `/` routes | Eliminates content-type sniffing bugs |
| No auth (open API) | Pluggable AuthAdapter | Enterprise IdP integration. Default: none for local dev. |

## Server UI

StoryShelf ships a **fixed, server-rendered UI** — `hono/jsx` + HTMX + `hono/css`. No client framework, no UI build step, no pluggable-UI adapter. Custom interfaces are built against `/api/v1` (the same contract the CLI uses, so it cannot be a second-class citizen). See ADR 0012.

- **Layout:** a branded top **header** (logo + name + accent, project context, theme toggle, user menu) plus a neutral left **sidebar** (Builds, Storybook, Settings). The content area is monochrome and image-first.
- **Pages** live in `core/src/routers/pages/*.tsx` and render directly from models (no API/UI contract duplication).
- **Layout & theming** live in `core/src/ui/` — a `DocumentLayout` (head, vendored HTMX, styles) plus a `BrandTheme` of light/dark color tokens.
- **Theme:** follows the system (`prefers-color-scheme`) with a manual light/dark override, persisted in a cookie so the server renders the correct theme on first paint.
- **Brand config** is passed as `ui: { name, logo, favicon, theme }` to `createShelfRouter` (see `ShelfOptions`). Env vars (`SS_BRAND_NAME`, `SS_LOGO_URL`) supply defaults so self-hosters can rebrand with a `docker run`, no code.
- **HTMX is vendored locally** (no CDN), so air-gapped deployments work.
- **Diff view (v1):** a simple three-up grid — baseline | current | diff overlay. A minimal vanilla-JS layer in `core/src/ui/scripts/` covers the theme toggle and keyboard approve/reject; the wipe slider and zoom are deferred to v2. The published-Storybook page is an `<iframe>` of Storybook's own static build.

## Deployment

### Docker (recommended)

```dockerfile
FROM mcr.microsoft.com/playwright:v1.52.0-noble
# Playwright image includes Chromium, Firefox, WebKit + system deps

WORKDIR /app
COPY package.json nub.lock ./
RUN nubx nub install --frozen-lockfile
COPY . .
RUN nubx nub run build

EXPOSE 3000
VOLUME /app/data

CMD ["node", "packages/server/dist/index.js", "serve", "--port", "3000", "--data-dir", "/app/data"]
```

```yaml
# docker-compose.yml
services:
  storyshelf:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - storyshelf-data:/app/data
    environment:
      - SECRET=your-hmac-secret-here
      # Capture + retention
      - CAPTURE_CONCURRENCY=2
      - PURGE_TTL_DAYS=30
      - PURGE_INTERVAL_MINUTES=60
      # Published Storybook subdomains (optional — omit for path-based URLs only)
      # - PUBLISHED_BASE_DOMAIN=stories.example.com   # requires wildcard DNS + TLS
      # Auth (optional — omit for no auth)
      - OIDC_ISSUER=https://keycloak.example.com/realms/myteam
      - OIDC_CLIENT_ID=storyshelf
      - OIDC_CLIENT_SECRET=your-client-secret
      # Or for shared password auth:
      # - AUTH_PASSWORD=your-shared-password

volumes:
  storyshelf-data:
```

Capture runs **in-process** on the server using the image's own Playwright browsers — no Docker socket mount, no repo cloning.

### Development

```sh
nubx nub install
nubx nub run dev          # starts Hono dev server
```

## Testing

See `docs/testing.md`. Unit, adapter-contract, and integration tests run on every CI (`nub run test`, vitest, hermetic — no browser). The capture pipeline is browser-gated: a separate `nub run test:integration` suite runs real Playwright against the committed Storybook fixture in `examples/storybook`.

## Website, Docs & Examples

See `docs/website.md`. The public site (`website/`, Astro Starlight) hosts guides plus an auto-generated API reference from the Hono OpenAPI spec. `examples/storybook` is the deterministic capture fixture; `examples/fly-app` deploys StoryShelf to fly.io as a public demo.

## Deliberately Deferred (v2)

1. **TurboSnap / `--only-changed`** -- v1 re-renders every story on every build. Functionally correct (unchanged stories auto-approve), but server CPU scales linearly with story count. This is the top scaling limit.
2. **Git-provider merge gate (GitHub App / GitLab)** -- rich check runs, per-snapshot annotations, and auto-reject on review rejection. v1 has the primitive (required commit status); the full integration is ADR 0010.
3. **Remote capture runners** -- offload capture to a worker fleet (SQS/HTTP). The `CaptureRunner` interface anticipates this.
4. **`parameters.chromatic` equivalents** -- `modes`/themes, per-story `delay`, `disableSnapshot`. `waitForReady` covers the basic "wait for data" case only.
5. **Ladle / Histoire / custom pages** -- the `StorySourceAdapter` interface anticipates them.
6. **Per-story `delay` / viewport presets per project** -- global viewport defaults only in v1.
7. **Linked projects / design-system propagation** -- when a design-system project approves a change, re-diff dependent projects against the new baseline. Not urgent; modeled as a future dependency edge between projects.
