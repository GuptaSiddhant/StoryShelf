# Architecture: deliberately deferred (v2)

> Moved out of [`docs/architecture.md`](../architecture.md) (now a pointer to [`docs/architecture/`](../architecture/README.md)) on 2026-11-04. It is history, not the current-state spec.

## Deliberately Deferred (v2)

1. **Affected capture** -- builds declare `affectedOnly` (default true); the CLI traces
   `git diff <baselineSha>..HEAD` through the Vite stats graph (`@storyshelf/affected`)
   and posts `affectedImportPaths`, and the orchestrator renders only affected stories
   while inheriting the rest unchanged from their baselines (new stories always render).
   Any uncertainty (shallow clone, missing stats/history, global-file change) falls
   back to a full render, and `--full` opts out per run.
2. **Git-provider merge gate (GitHub App / GitLab)** -- required commit statuses, GitHub check runs and per-snapshot annotations are implemented (ADR 0014); auto-reject on review rejection remains deferred.
3. **Remote browsers** -- render in a browser farm (ADR 0007). The runner `browsers` list, `CaptureTarget`, the public origin, remote connect (`./remote` presets), in-browser fingerprints, session limits and retries are in place; signed Storybook URLs (`/s/<token>/`), which `reach: "url"` targets use, are minted per render pass and served by the app.
4. **`parameters.chromatic` equivalents** -- `modes` are implemented (named modes from `parameters.chromatic.modes` / `parameters.storyshelf.modes`, ADR 0004); an args matrix is not. Per-story `delay`, `disableSnapshot`, `flakyTest`, `autoCrop`/sizing are implemented; `waitForReady` covers the basic "wait for data" case.
5. **Ladle / Histoire / custom pages** -- the `StorySourceAdapter` interface anticipates them.
6. **Per-story viewport presets** -- a story's Storybook `defaultViewport` is captured **in addition to** the project's global list (union, deduped by name; issue #82), including inline `parameters.viewport.viewports`. Global defaults remain the project-level surface.
7. **Linked projects / design-system propagation** -- automatically re-diffing dependent projects when a design-system project approves a change. Deferred: re-rendering a separate repo on its old `node_modules` produces no diff. The shipped alternative is provenance, not re-diffing: `project_links` (`PUT /api/v1/projects/:slug/links`) plus per-build `build_package_usage` power `GET …/snapshots/:id/usage`, which links a changed snapshot to the upstream component's published story. Tokens and automatic re-diff stay out of scope.
