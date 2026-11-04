# Data model

> Part of the [StoryShelf architecture spec](./README.md).

## Entity Model

Entity IDs are ULIDs, except attempt rows in `capture_jobs` (`<job_id>:<attempt>`; `attemptRowId` in `core/src/models/capture-job.ts`); `story_id` columns hold Storybook's own story id (`components-button--primary`), not a ULID. All timestamps are ISO-8601.

```sql
projects (
  id                  text PRIMARY KEY,        -- one project = one Storybook (not one git repo)
  name                text NOT NULL,
  slug                text NOT NULL UNIQUE,    -- URL-safe, human-readable; used in all HTML/public URLs
  git_repository      text,                    -- "owner/repo" (optional link; many projects may share a repo)
  git_default_branch  text NOT NULL DEFAULT 'main',
  pixel_threshold     real NOT NULL DEFAULT 0.1,    -- per-pixel color distance (0-1)
  max_diff_ratio      real NOT NULL DEFAULT 0.01,   -- max allowed diff ratio (0-1)
  public_branch_regex text,                    -- branches whose builds are publicly viewable (ADR 0010)
  run_a11y            boolean NOT NULL DEFAULT true,   -- axe accessibility checks during capture; results are shown in review and never block (ADR 0004, decision 6)
  run_tests           boolean NOT NULL DEFAULT false,  -- run Storybook 10 `.test()` entries as interaction tests during capture (ADR 0004, decision 10)
  detect_unstable     boolean NOT NULL DEFAULT true,   -- re-render a changed snapshot once and flag it when the two renders differ (advisory; `capture/stability.ts`)
  review_enabled      boolean NOT NULL DEFAULT true,   -- review on: non-default builds wait for a verdict (ADR 0013, decision 1)
  review_approvals    integer NOT NULL DEFAULT 1,      -- approvals a build needs with `testing` off (ADR 0013, decision 3)
  storybook_url_ttl_seconds integer,           -- lifetime of the signed Storybook URLs of a render; NULL derives it from the build (ADR 0007, decision 5)
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
  status              text NOT NULL DEFAULT 'pending',  -- pending|capturing|comparing|reviewing|approved|rejected|failed|cancelled
  snapshot_count      integer NOT NULL DEFAULT 0,
  changed_count       integer NOT NULL DEFAULT 0,
  approved_count      integer NOT NULL DEFAULT 0,
  rejected_count      integer NOT NULL DEFAULT 0,
  created_at          text NOT NULL,
  updated_at          text NOT NULL
);

-- One row per story x mode (viewport) x browser per build. `viewport_name` is the mode key: a
-- project viewport's name, or the slug of a named mode (ADR 0004).
snapshots (
  id                  text PRIMARY KEY,
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id            text NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  story_id            text NOT NULL,           -- "components-button--primary"
  story_name          text NOT NULL,           -- "Primary"
  story_title         text NOT NULL,           -- "Components/Button"
  story_import_path   text,                    -- "src/components/Button.stories.tsx"
  design_url          text,                    -- Figma URL the story declares (parameters.storyshelf.figma / design); NULL when none
  viewport_name       text NOT NULL DEFAULT 'desktop',  -- mode key (viewport name or mode-name slug)
  mode                text,                    -- JSON of the Storybook globals the mode applied (display/capture only)
  browser             text NOT NULL DEFAULT 'chromium',  -- capture target that rendered it: an engine, or '<engine>@<name>' for a remote browser (ADR 0007)
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
  a11y_violations     text,                    -- JSON array of the axe violation lines found on this capture (non-blocking); NULL when none or not checked (axe runs on the primary target only; `browser` names the target)
  unstable            boolean,                 -- true: a second render of this changed snapshot differed from the first (likely flaky); false: it matched; NULL: not re-rendered. Never changes `status`
  created_at          text NOT NULL,
  updated_at          text NOT NULL,
  baseline_id         text,                    -- baseline row the diff was computed against (NULL: none, or legacy row)
  baseline_version    text,                    -- that baseline's updated_at at diff time; 'none' = story had no baseline; NULL = legacy
  UNIQUE(build_id, story_id, viewport_name, browser)
);

-- Baseline pointers: the accepted screenshot for a story on a branch
baselines (
  id                  text PRIMARY KEY,
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  story_id            text NOT NULL,
  viewport_name       text NOT NULL DEFAULT 'desktop',  -- mode key
  mode                text,
  browser             text NOT NULL DEFAULT 'chromium',
  branch              text NOT NULL,           -- "main", "feature/xyz"
  snapshot_id         text,                    -- accepted snapshot (informational; may be purged)
  screenshot_path     text NOT NULL,           -- canonical baseline file (independent of builds)
  created_at          text NOT NULL,
  updated_at          text NOT NULL,
  UNIQUE(project_id, story_id, viewport_name, browser, branch)
);

-- Review comments (threaded; anchored to the build, a story or a snapshot, exactly one of the three)
comments (
  id                  text PRIMARY KEY,
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id            text NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  snapshot_id         text REFERENCES snapshots(id) ON DELETE CASCADE,  -- NULL = build-level comment
  user_id             text REFERENCES users(id) ON DELETE CASCADE,        -- NULL = anonymous (no auth)
  body                text NOT NULL,
  parent_id           text REFERENCES comments(id) ON DELETE CASCADE,   -- NULL = top-level, else reply
  resolved            boolean NOT NULL DEFAULT false,                   -- feedback addressed
  created_at          text NOT NULL,
  updated_at          text NOT NULL,
  story_id            text                                              -- Storybook story id of a story comment (ADR 0013, decision 2)
);

-- Build-level verdicts (ADR 0013, decision 3): a reviewer's newest row is their verdict
build_reviews (
  id          text PRIMARY KEY,                           -- ULID
  build_id    text NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  user_id     text REFERENCES users(id) ON DELETE CASCADE, -- NULL = no user (auth off, bearer token): one anonymous reviewer
  verdict     text NOT NULL,                              -- approved|rejected
  body        text,
  created_at  text NOT NULL                               -- strictly increasing within a build, so "newest" never ties
);
-- build_reviews_build_id_idx (build_id)
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

- **Build to Snapshot:** one build contains many snapshots (one per story x mode x browser). Review groups them by story and mode: one approval covers every browser (ADR 0004).
- **Baseline (table):** a pointer `(project, story, mode, browser, branch)` → the accepted screenshot file. The **file** (`screenshot_path`) is canonical; builds are transient and can be purged without losing baselines.
- **Accept:** copy the accepted snapshot's screenshot to the baseline path, upsert the `baselines` row for that branch.
- **Reject:** mark the snapshot rejected, no baseline change.
- **Access control:** a user's permissions on a project come from `project_members` (project-scoped role); `users.role = 'admin'` is a site-wide admin bypass (ADR 0011).
- **Label:** a typed value (`pr=123`, `jira=ABC-123`) attached to a build. Types are project-defined (`label_types`) and carry external link templates; the latest build for a `(key, value)` is resolved by query over `build_labels` joined to `builds`.

### Transactions on the built-in SQLite adapters

`node:sqlite`, better-sqlite3 and `bun:sqlite` run on one connection, so a plain statement issued while a `transact` callback is awaiting would land inside that transaction and be rolled back with it. The adapter therefore queues plain statements and transactions in arrival order, one at a time (`transaction-mutex.ts`), and a plain call on the outer adapter from inside a callback throws ``a plain <method> was called on the database inside its own transaction; use `tx` ``. Turso, D1, Postgres and MySQL have real transaction handles or pooled connections and do not queue.
