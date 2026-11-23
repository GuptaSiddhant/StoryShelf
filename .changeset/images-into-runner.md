---
"@storyshelf/core": minor
"@storyshelf/runner": minor
"@storyshelf/app": patch
---

Breaking: the image engine moves from `@storyshelf/core/diff` to `@storyshelf/runner/images`

Everything that touches pixels (the PNG codecs, the diff worker pool, pixelmatch, overlays and thumbnails) now lives in `@storyshelf/runner/images`, and the `@storyshelf/core/diff` subpath is removed (#1365). Core no longer declares `pngjs`, `pixelmatch` or `sharp`: `pngjs` and `pixelmatch` are dependencies of the runner, and `sharp` is an optional peer of the runner, so install `sharp` next to `@storyshelf/runner` for the `sharp` engine.

- Core keeps the contract in `@storyshelf/core/adapter/capture-runner`: `ImageEngine` (`configure`, `verify`, `compare`, `downscale`, `state`, `shutdown`), `ImageEngineName`, `ImageSettings`, `ImageEngineState`, `DiffOptions`, `DiffResult`, `DEFAULT_DIFF_OPTIONS`, `IMAGE_ENGINE_ENV` and `DIFF_WORKERS_ENV`.
- `CaptureRunner` gains a required `images: ImageEngine`. The Playwright runner supplies `createImageEngine()`; a custom runner can do the same.
- `testing.images` and `testing.compare` are unchanged: the app passes them to `runner.images.configure` and verifies the engine at setup.
- The old `ImageEngine` string type is now `ImageEngineName` in `@storyshelf/runner/images`; `configureDiffPool` is removed (use `configureImages`).
- A hosting-only server shows the image engine as `off` on the System page.
