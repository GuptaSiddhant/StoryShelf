---
"@storyshelf/core": minor
---

Breaking: runner-puppeteer is removed; use the Playwright runner (one re-baseline).

`@storyshelf/runner-puppeteer` was deprecated in 0.14.0 and is gone in 0.15.0: the package, its capture CI leg and its docs. Playwright is the only capture runner. To switch, follow "Switching from Puppeteer to Playwright" in the upgrading guide. The first build after switching is accepted on the default branch as an environment migration. No further versions of the package are published.
