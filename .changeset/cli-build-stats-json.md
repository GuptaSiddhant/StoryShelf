---
"storyshelf": patch
---

The CLI builds Storybook with `--stats-json` when affected capture is on, so the default upload path no longer falls back to a full render. Set `buildStats: false` (or `--no-build-stats`) for a build script that rejects the flag; a custom `buildCommand` is left alone and a missing stats file prints one warning.
