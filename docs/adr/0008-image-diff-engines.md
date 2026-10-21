# ADR 0008: Image Diff Engines

## Status

Accepted

Supersedes (archived): ADR 0004, ADR 0032

## Context

After the server captures screenshots (ADR 0004 Capture Pipeline), it compares them against
baselines (ADR 0009 Baselines, Approval and Retention) and produces a diff result. The comparison
needs a reliable, open-source engine that is fast enough for CI and needs no external service.

On large full-page screenshots the PNG work dominates a diff: decoding two images and encoding the
overlay of a failing diff. Benchmarks on the website screenshots (M1 Max, Node 24; `nub run bench`
in `packages/image`) put `sharp` (libvips) at 4x faster to decode, 12x faster to encode the overlay
and 2-5x faster per diff. Native code is not portable (Workers-style runtimes, platforms without
prebuilt binaries), so it cannot be the default. The default stays pure JavaScript with no native
dependencies, so one `docker run` keeps working.

## Decision

1. **The comparator is `pixelmatch`.** It is battle-tested (Playwright uses it internally), fast,
   detects anti-aliasing and has a configurable threshold. The PNG codec is `pngjs` by default.
   Anti-aliasing and threshold behaviour define what a baseline means, so the comparator is not
   swappable per deployment.
2. **One leaf package, `@storyshelf/image`,** owns everything that touches pixels: the diff
   (`diffImages` / `diffImagesAsync`), the worker-thread pool, overlay rendering and thumbnails
   (`downscalePng`). It imports nothing from `@storyshelf/*`; `@storyshelf/core` depends on it (a
   test enforces the leaf rule) and `@storyshelf/core/diff` re-exports it. `pixelmatch` and `pngjs`
   have this package as their single production owner.
3. **The engine is the codec.** An `ImageCodec` decodes PNG to RGBA, encodes RGBA to PNG and
   downscales. `pngjs` is the default; `sharp` is an optional peer dependency. Because the
   comparison never changes, verdicts and pixel counts are identical across codecs. Parity tests
   cover RGB, RGBA, greyscale, palette, interlaced and gamma-tagged PNGs; 16-bit PNGs may differ by
   one level of 255 from rounding.
4. **The engine is a deployment-wide string** under the `testing` option (ADR 0006 Testing Option,
   Hosting-Only Mode and the Database Queue):

   ```ts
   createShelfApp({
     database,
     storage,
     testing: {
       runner,
       images: { engine: "sharp" }, // "pngjs" (default) | "sharp"
       compare: { threads: 2 },
     },
   });
   ```

   `STORYSHELF_IMAGE_ENGINE` sets the same value when the option is absent; the option wins, so a
   bad variable cannot break an explicit option. A string crosses the worker-thread boundary and
   keeps the dynamic import visible to bundlers. An object form can be added later without
   breaking it. `images` and `compare` live under `testing` because diffs, overlays and snapshot
   thumbnails (including AI evidence thumbnails) do not exist without capture; an instance that
   needs either is an instance with `testing`.

5. **Fail loud.** An unknown engine name throws when the app is created. A missing or unloadable
   `sharp` fails readiness under the `images` category at boot. There is no silent fallback to
   `pngjs`, which could change behaviour without anyone noticing.
6. **Diffs run on a worker-thread pool.** `diffImagesAsync` uses a `worker_threads` pool
   (`src/diff/worker.ts`, a separate bundler entry resolved relative to the module) so diffing does
   not stall Playwright's protocol traffic. `compare.threads` sets the size (default
   `max(1, availableParallelism() - 1)`; `0` means in-thread). `ArrayBuffer`s are transferred, not
   copied; `sharp` returns Buffers over native memory that cannot be transferred, so its encoded
   overlay is copied once. Inside pool workers `sharp` is capped at one libvips thread each, since
   the pool already parallelises. The pool falls back to the synchronous path when
   `worker_threads` is unavailable (Deno, edge) or the worker fails to load. A worker dying before
   `ready` is a load failure only while no worker has ever started; afterwards it is a crash, and
   the pool gives up only after three in a row. A busy worker always finishes its diff before the
   pool stops, and the fallback emits one `STORYSHELF_DIFF_POOL_FALLBACK` process warning. The
   pool belongs to the app, so re-diff uses it too.
7. **Cheap paths first.** Both buffers are hashed first; on a match the dimensions are read from the
   PNG header and the diff returns `passed: true`, zero pixels and no overlay. Identical content
   addresses (ADR 0003 Storage and Content-Addressed Assets) skip the diff without reading either
   image. `pixelmatch` runs with a `null` output buffer first, and the overlay is rendered and
   encoded only when the diff fails.
8. **Configuration.** `pixelThreshold` is the per-pixel colour distance (the `pixelmatch`
   threshold); `maxDiffRatio` is the allowed ratio of differing pixels. The names match their
   meaning. Both are per-project settings (`pixel_threshold`, `max_diff_ratio` on `projects`) and
   the CLI can override them per run (`--max-diff-ratio`, `--pixel-threshold`). The `DiffOptions`
   and `DiffResult` types live in `docs/architecture.md` (Pixel Diff Engine).
9. **Overlay.** The diff image shows unchanged pixels at 50% opacity (greyed) and changed pixels in
   red (`[255, 0, 0]`), a heat map of what changed. It is stored next to the build's other
   artefacts and served by the review UI.
10. **New and removed stories.** The absence of a baseline is not a diff: a story with no baseline
    is handled by the rules in ADR 0009, and a removed story runs no diff.
11. **No schema change for the engine.** Baselines are stored pixels and every diff is computed
    fresh by the current engine, so the engine is not stored per snapshot. It is logged on the
    capture attempt's `render pass finished` line. The capture fingerprint's `engine` is the
    browser engine; putting the diff engine there would turn an engine switch into an environment
    migration.
12. **Where the setting applies.** The server configures the image engine and verifies it at boot.
    A forked capture child inherits `STORYSHELF_IMAGE_ENGINE` and `STORYSHELF_DIFF_WORKERS` from the
    parent (ADR 0006), so parent and child agree.

## Consequences

**Positive**

- Same comparator Playwright uses, consistent with developer expectations.
- Fast enough for CI; `sharp` is available when large screenshots dominate.
- No external service dependency, and no native dependency by default.
- Diffing off the main thread keeps capture concurrency close to its nominal setting.
- Switching codecs never changes a verdict, so it never invalidates baselines.

**Negative**

- Pixel comparison can produce false positives on anti-aliased text, sub-pixel rendering or
  animation remnants. Mitigated by deterministic rendering (ADR 0004), animation disabling and
  threshold tuning.
- `diffImages` is async because a `sharp` codec is async.
- A native codec makes the parity tests mandatory.

## Alternatives rejected

| Option                         | Why not                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| resemble.js                    | Slower and less precise at pixel level.                                                                                                              |
| Applitools Visual AI           | Proprietary and SaaS-only, not self-hostable.                                                                                                        |
| SSIM                           | Computationally expensive and not suited to CI speed.                                                                                                |
| `odiff` as the comparator      | Different anti-aliasing and threshold behaviour would invalidate existing baselines; not a drop-in. See open questions.                              |
| Rewrite diff in Rust or Go     | Node mostly awaits IPC while Chromium renders in its own processes; `sharp` plus workers captures most of the codec gain without a second toolchain. |
| Silent fallback to `pngjs`     | Behaviour would change without anyone noticing.                                                                                                      |
| Diff engine in the fingerprint | An engine switch would become an environment migration.                                                                                              |

## Open questions

- `odiff` (native comparator) is about 2.5x faster than `sharp` plus `pixelmatch` only when many
  pixels differ, at the cost of a server process per worker, temp files, a different overlay and
  slightly different pixel counts. It would be a comparator under `compare.engine`, a deliberate
  baseline migration, and is not planned.
- Whether the official Docker image should default to `STORYSHELF_IMAGE_ENGINE=sharp` once `sharp`
  has run in production.
- `compressionLevel` and `maxPixels` options.
