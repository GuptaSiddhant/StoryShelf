# Data model: labels, design sources and links

> Part of the [StoryShelf architecture spec](./README.md).

## Entity Model (continued): labels, design sources and links

```sql
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

-- Design-source links (issue #141). import_path NULL = project-level design file link
-- (library header); import_path set = manual component mapping (story file -> design URL).
design_links (
  id          text PRIMARY KEY,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  import_path text,                        -- normalized story file ("src/Button.stories.tsx"), no leading "./"
  label       text,                        -- display label of a project-level link
  url         text NOT NULL,               -- URL validated by a design provider
  created_at  text NOT NULL,
  updated_at  text NOT NULL,
  UNIQUE(project_id, import_path)          -- one mapping per story file (NULL import_path never collides)
);

-- The project-wide design-provider token an admin pastes. `provider` = DesignProvider metadata.kind
-- ("figma"). Encrypted under ShelfConfig.secret and rotated with the other credentials, never displayed.
-- created_at = when the credential was set/replaced and drives the provider's max-age clock;
-- status/checked_at record the last API outcome (unknown | ok | unauthorized | forbidden) and never move
-- created_at/updated_at. Members' own OAuth connections live in user_connections (ADR 0011).
design_credentials (
  id               text PRIMARY KEY,
  project_id       text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider         text NOT NULL,
  token_encrypted  text NOT NULL,
  status           text NOT NULL DEFAULT 'unknown',
  checked_at       text,
  created_at       text NOT NULL,
  updated_at       text NOT NULL,
  UNIQUE(project_id, provider)
);

-- Design metadata + render cache keyed by (project, provider, viewer, file key, node id; node '' = whole
-- file). viewer_id '' = fetched with the project credential; a user id = fetched with that user's own
-- access (such entries are served only to that user; see ADR 0011). state: ok | deleted | unauthorized |
-- forbidden. Refreshed on view when older than 15 min; outages keep the last good row.
design_nodes (
  id             text PRIMARY KEY,
  project_id     text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider       text NOT NULL,
  viewer_id      text NOT NULL DEFAULT '',
  file_key       text NOT NULL,
  node_id        text NOT NULL DEFAULT '',
  name           text,
  version        text,
  last_modified  text,
  state          text NOT NULL DEFAULT 'ok',
  render_path    text,                     -- storage path of the cached PNG render (node links only)
  render_version text,                     -- file version the render was taken at
  notified_version text,                   -- claim of the last `design:changed` event sent for this node: `<change key>#<ulid>`, NULL when none; set by compare-and-set so one caller announces a change (project-credential rows only)
  fetched_at     text NOT NULL,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  UNIQUE(project_id, provider, viewer_id, file_key, node_id)
);

-- A user's own OAuth connection to an external service (service = adapter kind, e.g. figma; ADR 0011).
-- Tokens are encrypted; status: ok | expired (refresh failed - the user must reconnect).
user_connections (
  id                      text PRIMARY KEY,
  user_id                 text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service                 text NOT NULL,
  token_encrypted         text NOT NULL,
  refresh_token_encrypted text,
  expires_at              timestamp,
  status                  text NOT NULL DEFAULT 'ok',
  created_at              timestamp NOT NULL,
  updated_at              timestamp NOT NULL,
  UNIQUE(user_id, service)
);

-- Linked projects (components only, see issue #123): a downstream app declares which upstream
-- project publishes a package it consumes. Used to render "Uses @acme/ds" provenance + deep links.
project_links (
  id            text PRIMARY KEY,
  downstream_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  upstream_id   text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  package_name  text NOT NULL,             -- "@acme/ds"
  created_at    text NOT NULL,
  UNIQUE(downstream_id, package_name)
);

-- Per-build package usage, reported by the CLI at upload (it has the stats graph and node_modules).
-- One row per (story file, package): the shallowest module of the package the story reaches.
-- Joined to snapshots on story_import_path at read time, so rows scale with story files, not viewports.
build_package_usage (
  id                text PRIMARY KEY,
  project_id        text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id          text NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  story_import_path text NOT NULL,
  package_name      text NOT NULL,
  module_path       text NOT NULL,
  version           text,                  -- installed version at upload; null when unresolved
  created_at        text NOT NULL
);
```
