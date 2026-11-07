# StoryShelf Architecture

> **Visual companion:** [`architecture-diagrams.md`](../architecture-diagrams.md) — 18 Mermaid diagrams (system context, containers, capture pipeline, baseline resolution, ER model, storage, deployment, etc.) derived from this spec.

The current-state spec for StoryShelf: entities, interfaces and workflows, one file per area. Decisions and their reasons live in the ADRs ([`docs/adr/`](../adr/README.md)); the package and folder layout is owned by [`docs/repo-structure.md`](../repo-structure.md). Retired material (the StoryBooker comparison and the v2 deferral list) is under [`docs/archive/`](../archive/).

| Area                | File                                                                   | Holds                                                                                                          |
| ------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Overview            | [`overview.md`](./overview.md)                                         | What StoryShelf is; the product workflow from push to merge                                                    |
| Data model          | [`data-model.md`](./data-model.md)                                     | Projects, builds, snapshots, baselines, comments, build reviews; key relationships                             |
|                     | [`data-model-labels-and-design.md`](./data-model-labels-and-design.md) | Label types, build labels, design links, credentials and nodes, user connections, project links, package usage |
|                     | [`data-model-access-and-system.md`](./data-model-access-and-system.md) | Tokens, webhooks, users, invites, project members, `capture_jobs`, site settings, build components             |
| Storage             | [`storage.md`](./storage.md)                                           | The storage layout and keys                                                                                    |
| Capture             | [`capture.md`](./capture.md)                                           | Capture pipeline, renderer, orchestrator, story source, capture flow, deterministic rendering                  |
|                     | [`capture-queue.md`](./capture-queue.md)                               | The database queue (`capture_jobs`)                                                                            |
| Review              | [`review.md`](./review.md)                                             | Baseline resolution, review workflow, comments, verdicts, status checks and the merge gate                     |
| Diff                | [`diff.md`](./diff.md)                                                 | Pixel diff engine and overlay                                                                                  |
| AI                  | [`ai-insights.md`](./ai-insights.md)                                   | AI insights                                                                                                    |
| Retention           | [`retention.md`](./retention.md)                                       | What is purged and what never is                                                                               |
| Published Storybook | [`published-storybook.md`](./published-storybook.md)                   | Hosting a build's Storybook, URLs, subdomains                                                                  |
| UI                  | [`ui.md`](./ui.md)                                                     | Component, library and build pages; the server-rendered UI                                                     |
| Design and labels   | [`design-and-labels.md`](./design-and-labels.md)                       | Design sources and build labels                                                                                |
| API                 | [`api.md`](./api.md)                                                   | The `/api/v1` surface and the UI routes                                                                        |
| Tech stack          | [`tech-stack.md`](./tech-stack.md)                                     | Technology choices; testing and website pointers                                                               |
| Deployment          | [`deployment.md`](./deployment.md)                                     | Docker, hosting and local development                                                                          |

Link to a section by its anchor (for example `architecture/review.md#baseline-changes-after-a-diff`), not by line number: the files change.
