# Architecture history: what changed from StoryBooker

> Moved out of [`docs/architecture.md`](../architecture.md) (now a pointer to [`docs/architecture/`](../architecture/README.md)) on 2026-11-04. It is history, not the current-state spec.

## What Changed from StoryBooker

| StoryBooker                                                     | StoryShelf                                        | Why                                                        |
| --------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| Capture = upload pre-captured screenshots                       | Capture = upload Storybook build, server renders  | Deterministic rendering without cloning repos              |
| No ORM (raw adapter calls)                                      | Drizzle ORM                                       | Type-safe schema, migrations, query builder                |
| LocalFileDatabase (JSON)                                        | SQLite + Turso                                    | ACID on VPS/Docker. Turso for serverless                   |
| AsyncLocalStorage for models                                    | Constructor injection                             | Models take adapters as constructor args                   |
| 7 compute adapters (5 untested)                                 | 1 CaptureRunner + database queue                  | Capture is a fixed pipeline, not user-defined jobs         |
| Build ID = git SHA                                              | ULID + `git_sha` column                           | Re-runs, squash/merge-safe                                 |
| Stringified DynamoDB values                                     | SQLite native types                               | Proper booleans, numbers, JSON columns                     |
| Per-project S3 buckets                                          | Local filesystem + S3 option                      | Local default. S3-compatible for cloud                     |
| 1 project = 1 repo                                              | 1 project = 1 Storybook (many per repo)           | Monorepos with multiple Storybooks                         |
| 4 fixed variants (storybook, testReport, coverage, screenshots) | Snapshots table (per story x viewport)            | Per-story tracking for visual testing                      |
| `tagIds: "a,b"` comma-separated                                 | Project-defined label types + `build_labels` join | Typed, configurable, link templates, stable-URL resolution |
| `compute.jobs[]` nested in Project                              | No jobs table in v1                               | Capture is a fixed pipeline                                |
| `latestBuildId` on Project                                      | `baselines` per branch                            | Baseline is per branch, not per project                    |
| Dual-mode HTML/JSON routes                                      | Separate `/api/v1` and `/` routes                 | Eliminates content-type sniffing bugs                      |
| No auth (open API)                                              | Auth singleton (`@storyshelf/auth`)               | Enterprise IdP integration. Default: none for local dev.   |
