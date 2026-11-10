# Data model: access, webhooks, queue and system tables

> Part of the [StoryShelf architecture spec](./README.md).

## Entity Model (continued): access, webhooks, queue and system tables

```sql
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
  secret_encrypted    text NOT NULL,           -- HMAC secret, AES-256-GCM with server SECRET (rotation: ShelfConfig.previousSecret, see guides/deployment/secret-rotation)
  events              text,                    -- JSON array or NULL for all
  created_at          text NOT NULL,
  updated_at          text NOT NULL
);

-- Users (created by auth engine on login, optional if no auth configured)
users (
  id                  text PRIMARY KEY,        -- engine ULID (shared with Better Auth user.id)
  email               text NOT NULL UNIQUE,    -- identifier; deliverability never checked for local accounts
  name                text NOT NULL,           -- IdP/engine value; display_name_override wins for rendering
  avatar_url          text,
  role                text NOT NULL DEFAULT 'member',  -- 'admin' (site-wide) | 'member' (access via project_members)
  last_login_at       text,
  created_at          text NOT NULL,
  password_hash       text,                    -- legacy scrypt (pre-engine local); engine locals use Better Auth credential rows
  display_name_override text,                  -- user-edited name, survives IdP refresh
  auth_provider       text NOT NULL DEFAULT 'local',  -- 'local' | 'oidc' (engine provider)
  disabled            integer NOT NULL DEFAULT 0     -- login rejected when true; engine sessions revoked eagerly
);

-- Invite tokens for local accounts (one-time links, invite-only onboarding)
user_invite_tokens (
  id                  text PRIMARY KEY,
  user_id             text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash          text NOT NULL UNIQUE,    -- sha256 of the one-time token (shown once, never stored)
  expires_at          text NOT NULL,           -- default invite creation + 7 days
  used_at             text,                    -- NULL until accepted (single use)
  created_at          text NOT NULL
);

-- Project-scoped authorization: a user's role on a specific project. With sign-in on, a caller with no
-- role at all, signed in or anonymous, gets 404 `Project not found` on every project-scoped route
-- (`assertRole`, the `requireProjectVisible` page gate, `hiddenFrom` on the Storybook routes and the
-- `/_/:id` short links), identical to an unknown slug; public builds stay readable and a signed `/_s/`
-- URL keeps its read-only grant. 403 means a role that is too low.
project_members (
  id                  text PRIMARY KEY,
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id             text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                text NOT NULL DEFAULT 'viewer',  -- admin|approver|developer|viewer
  created_at          text NOT NULL,
  UNIQUE(project_id, user_id)
);

-- Database capture queue (ADR 0006, decision 4): job rows and per-attempt claim rows in one table
capture_jobs (
  id                  text PRIMARY KEY,        -- job row: ULID; attempt row: '<job_id>:<attempt>'
  entry               text NOT NULL,           -- 'job' | 'attempt'
  job_id              text NOT NULL,           -- the job this row belongs to (a job row's own id)
  kind                text NOT NULL,           -- 'capture' | 'publish' | 'notify'
  build_id            text,                    -- notify jobs may have none (no FK: rows outlive nothing)
  shard_id            text,                    -- capture_shards row of a shard job
  attempt             integer NOT NULL DEFAULT 0,  -- job: attempts started; attempt row: its number (1..)
  max_attempts        integer NOT NULL DEFAULT 3,  -- testing.retries + 1
  status              text NOT NULL,           -- job: queued|running|done|failed|cancelled; attempt: running|done|failed|expired
  visible_at          text,                    -- queued job: claimable from; running attempt: lease expiry; else NULL
  owner               text,                    -- instance holding an attempt
  payload             text,                    -- JSON: reqId, traceparent, kind-specific data
  cancel_requested_at text,                    -- cancel flag, never cleared
  active_key          text,                    -- single-flight job kinds: unique while the job is not terminal; cleared when it ends; never on attempt rows
  rerun_requested_at  text,                    -- running job: a request for its key arrived, so a successor job runs one more pass
  error               text,
  started_at          text,
  finished_at         text,
  created_at          text NOT NULL,
  updated_at          text NOT NULL
);
-- capture_jobs_poll_idx (kind, visible_at, status): the poll probe; plus (job_id), (build_id), (entry, created_at); unique (active_key): at most one non-terminal job per key (ADR 0040), NULLs never collide

-- Site-wide key-value settings the app learns while running (ADR 0007, decision 6). Key 'public_origin'
-- holds JSON {origin, confirmed}: the origin a site admin's browser reported (confirmed: false until an admin confirms it), written only by a
-- site-admin, CSRF-protected route
site_settings (
  id          text PRIMARY KEY,                           -- the setting's key
  value       text NOT NULL,
  updated_by  text,                                       -- user id behind the write, NULL for none
  created_at  text NOT NULL,
  updated_at  text NOT NULL
);

-- Components of a published build (ADR 0006, decision 9): one row per story file, written from the
-- build's Storybook index when publishing ends (or lazily on first view of an older build)
build_components (
  id           text PRIMARY KEY,                          -- ULID
  project_id   text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id     text NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  import_path  text NOT NULL,                             -- story file without './'; '' when the index names none
  title        text NOT NULL,
  story_count  integer NOT NULL DEFAULT 0,                -- story entries; docs entries are not counted
  hash         text NOT NULL,                             -- SHA-256 over the component's entries (id, name, type, title)
  created_at   text NOT NULL
);
-- build_components_build_id_idx (build_id), build_components_project_import_path_idx (project_id, import_path)
```
