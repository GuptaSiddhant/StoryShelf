# ADR 0003: Server-Side Capture (Upload Storybook, Render Asynchronously)

## Status

Accepted

## Context

The core missing feature versus Chromatic is automated screenshot capture. Chromatic renders each Storybook story in a controlled cloud browser and captures a pixel-perfect screenshot. StoryBooker required users to provide pre-captured screenshots manually.

Two candidate architectures were considered:

1. **Client-side capture (the Lost Pixel model):** the CLI runs Playwright locally in CI and uploads PNGs. The server only diffs. This pushes browser-version determinism onto the user's arbitrary CI environment and forces the CLI to ship ~150MB of browser binaries.

2. **Server-side render:** the CLI builds Storybook, uploads the *static build*, and the server renders stories in its own pinned Playwright environment.

A third option — the server **clones the git repo** and builds Storybook itself — was rejected. StoryBooker needed that to run arbitrary user build scripts; StoryShelf does not, because the CLI already built the Storybook. Cloning repos server-side adds a git-credential surface, a Docker socket (DinD) mount, and the entire guardian/reconciliation complexity that StoryBooker's compute system accumulated.

## Decision

**Server-side render.** The CLI builds Storybook (or reuses an existing build), zips the static output, and uploads it. The server renders stories with Playwright in its own pinned environment.

The capture flow (upload → enqueue → serve → render → diff) and the full `CaptureRunner` interface are specified in `docs/architecture.md` (Capture Pipeline).

### Capture Renderer

A single pure `CaptureRunner` interface (`render(input)`, `cancel(buildId)`) with one local implementation in v1. The renderer is intentionally free of server concerns (no database, storage, or build state); the server-side **orchestrator** (see ADR 0015) owns loading, extraction, discovery, and persistence. The interface stays thin so v2 can add a remote runner (offload capture to a worker fleet) without changing the pipeline or orchestration.

### Async queue

Everything after upload is asynchronous: `POST /builds` stores the zip and returns `202 Accepted`; an in-process queue with configurable concurrency (`--capture-concurrency`, default `2`) runs captures. A build stuck in `capturing` across a restart is re-queued or marked `failed`.

### Why Playwright over alternatives

| Option | Pros | Cons |
|--------|------|------|
| **Playwright** | Industry standard, multi-browser, `toHaveScreenshot` battle-tested, deterministic rendering, Docker images available | ~150MB browser binaries |
| Puppeteer | Lighter | Chromium-only, less maintained |
| BackstopJS | Self-contained | Full-page only, not component-level |
| Storybook test-runner | Storybook-native | Requires running Storybook server |

### Why server-side render (and not client-side capture)

- **Deterministic rendering** -- the server pins the browser version; the CLI's CI environment is irrelevant.
- **No browser binaries in the CLI** -- the CLI is a thin zip-and-upload client.
- **No repo cloning** -- no git credentials on the server, no Docker socket, no guardian/reconciliation loop.
- **Re-runs are cheap** -- re-capture an existing build without re-uploading.

## Consequences

**Positive:**
- Server controls rendering determinism; the capture image and browser are one pinned artifact
- CLI stays lightweight (no Playwright dependency)
- One adapter interface; no script generation, no user-defined job steps
- Cloud runners (v2) can be added without changing the capture logic

**Negative:**
- Upload payload is the full Storybook static build (can be tens of MB) -- mitigated by zip + resumable re-runs
- Server CPU is the scaling bottleneck (every build re-renders every story) -- TurboSnap is the v2 answer
- Server must serve the uploaded statics over HTTP during capture (Storybook needs an origin to fetch JS/assets)

**Mitigation:** the capture pipeline serves the extracted statics on a local ephemeral port; the pinned Playwright image guarantees identical browsers across deployments.
