---
"@storyshelf/core": minor
"@storyshelf/runner": minor
---

Changed: hosting-only installs skip the testing libraries (axe-core, pngjs, pixelmatch)

`axe-core` moves to `@storyshelf/runner`, with `axeInjectionScript` and `loadAxeSource` (now exported from the runner, no longer from `@storyshelf/core/capture`). `pngjs` and `pixelmatch` become optional peers of `@storyshelf/core`, used only by `./diff`, and `@storyshelf/runner` depends on them, so a testing install gets them and a hosting-only install (about 3.9 MB less) holds none. `./diff` imports them on first comparison; `verifyImageEngine` runs only with `testing`, and a missing peer fails readiness with a message naming the package and the install line. `sharp` is unchanged.

Schema: none.
