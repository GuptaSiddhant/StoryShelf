# @storyshelf/runner-playwright (deprecated)

This package is now **`@storyshelf/runner`**. It re-exports it, every subpath included, for one minor
release (0.15.0) and then retires.

```sh
nub remove @storyshelf/runner-playwright
nub add @storyshelf/runner
```

`createPlaywrightCaptureRunner` is now `createCaptureRunner` (the old name stays as a deprecated
alias in `@storyshelf/runner`). Imports from `@storyshelf/runner-playwright/remote` become
`@storyshelf/runner/remote`. Nothing else changes. See `packages/runner/README.md`.
