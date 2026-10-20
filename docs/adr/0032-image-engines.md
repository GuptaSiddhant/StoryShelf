# ADR 0032: Image Engines (`@storyshelf/image`, opt-in `sharp`)

## Status

Accepted. Amends [ADR 0004](0004-pixel-diff-engine.md): pixelmatch stays the comparator; the PNG codec becomes selectable.

## Context

ADR 0004 chose `pixelmatch` + `pngjs`: pure JavaScript, no native dependencies, one `docker run`. On large full-page screenshots the PNG work dominates a diff: decoding two images, and encoding the overlay of a failing diff. Benchmarks on the website screenshots (M1 Max, Node 24; `nub run bench` in `packages/image`) put `sharp` (libvips) at 4x faster to decode, 12x faster to encode the overlay, and 2-5x faster per diff. Native code is not portable (Workers-style runtimes, platforms without prebuilt binaries), so it cannot become the default.

The image code was also scattered: the diff engine and worker pool lived in `core/diff`, and PNG thumbnails for AI evidence in `core/insights`, each with its own `pngjs` use.

## Decision

1. **One leaf package, `@storyshelf/image`,** owns everything that touches pixels: the diff (`diffImages`/`diffImagesAsync`), the worker-thread pool, overlay rendering, and thumbnails (`downscalePng`). It imports nothing from `@storyshelf/*`; `@storyshelf/core` depends on it (a test enforces the leaf rule). `@storyshelf/core/diff` re-exports it. `pixelmatch` and `pngjs` move here as the single production owner.
2. **The comparator is always pixelmatch; the engine is the codec.** An `ImageCodec` decodes PNG to RGBA, encodes RGBA to PNG, and downscales. `pngjs` is the default; `sharp` is an optional peer dependency. Because the comparison never changes, verdicts and pixel counts are identical (the parity tests prove it for RGB, RGBA, greyscale, palette, interlaced and gamma-tagged PNGs; 16-bit PNGs may differ by one level of 255 from rounding).
3. **Public API is a string,** deployment-wide: `createShelfApp({ images: { engine: "sharp" } })`, or `STORYSHELF_IMAGE_ENGINE`; the option wins. Values are `"pngjs"` (default) and `"sharp"`. A string crosses the worker-thread boundary and keeps the dynamic import visible to bundlers. An object form can be added later without breaking it.
4. **Fail loud.** An unknown name throws when the app is created. A missing or unloadable `sharp` fails readiness under the `images` category at boot. There is no silent fallback to `pngjs`, which could change behavior without anyone noticing.
5. **No schema change.** Baselines are stored pixels and every diff is computed fresh by the current engine, so the engine is not stored per snapshot. It is logged on the capture attempt's `render pass finished` line. (The capture fingerprint's `engine` is the *browser* engine, and putting the diff engine there would turn an engine switch into an environment migration.)

## Consequences

- `diffImages` is now async (a `sharp` codec is async). `diffImagesAsync`, `DiffPool`, and the worker were adapted; `buildTriageEvidence` became async and downscales only the images it keeps.
- `sharp` returns Buffers over native memory that workers cannot transfer, so its encoded overlay is copied once.
- `configureDiffPool` became `configureImages({ engine, threads })` (still re-exported from `@storyshelf/core/diff`).

## Deferred

- **odiff** (native comparator): about 2.5x faster than `sharp` + pixelmatch only when many pixels differ, at the cost of a server process per worker, temp files, a different overlay, and slightly different pixel counts. It would be a comparator under `compare.engine`, not a codec.
- **Docker image default:** shipping `STORYSHELF_IMAGE_ENGINE=sharp` in the official image once `sharp` has run in production.
- **`compressionLevel` and `maxPixels`** options, and video capture and preview (a separate ADR).
