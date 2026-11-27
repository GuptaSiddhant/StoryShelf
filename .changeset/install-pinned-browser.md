---
"create-storyshelf": patch
"@storyshelf/runner": patch
"@storyshelf/app": patch
"@storyshelf/core": patch
"storyshelf": patch
---

Fixed: the quick start installs the pinned browser, and the missing-browser hint names the right command

The bare-node next steps, the scaffold README and the get-started guide now run `npx playwright-core install chromium`, which installs the revision the project's `playwright-core` needs (the old `playwright install` hint fetched the latest). The server warns at start when the default browser is not installed (health stays `ok`), the build page shows the capture error without the `UserFacingError:` prefix, and `upload --wait` points to the build page for the reason.

Schema: none
