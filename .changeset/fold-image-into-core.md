---
"@storyshelf/core": minor
"@storyshelf/image": minor
---

Changed: the image engine moves into core; `@storyshelf/image` is a deprecated re-export (#879)

The codecs, worker pool and pixelmatch engine now live in `@storyshelf/core/diff`, which exports everything `@storyshelf/image` did. `pixelmatch` and `pngjs` are core dependencies and `sharp` is an optional peer of core (same range, `>=0.34.0`), so install `sharp` next to `@storyshelf/core` to use the `sharp` engine. The comparison is unchanged.

`@storyshelf/image` is deprecated: it re-exports `@storyshelf/core/diff` for this one minor release and is then no longer published (ADR 0049). Import from `@storyshelf/core/diff` instead.
