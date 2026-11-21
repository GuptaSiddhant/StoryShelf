---
"@storyshelf/runner": minor
"@storyshelf/runner-playwright": minor
---

Changed: @storyshelf/runner-playwright is now @storyshelf/runner (old name re-exports for one minor)

`@storyshelf/runner-playwright` is renamed `@storyshelf/runner` now that Playwright is the only runner. Every subpath (`@storyshelf/runner/remote`) and option is unchanged, and so are captures: no schema change, no behaviour change and no new baseline. `createPlaywrightCaptureRunner` is now `createCaptureRunner`; the old name stays as a deprecated alias. `@storyshelf/runner-playwright` 0.15.0 is a thin deprecated re-export of `@storyshelf/runner`, every subpath included, and retires after 0.16.0. `server init` scaffolds `@storyshelf/runner`. Schema: none.
