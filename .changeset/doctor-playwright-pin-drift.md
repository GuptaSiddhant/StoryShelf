---
"@storyshelf/app": patch
---

Fixed: `storyshelf-server doctor` warns when the project's `playwright-core` pin drifts from the runner's

When the project pins `playwright-core` and it differs from the version `@storyshelf/runner` resolves, doctor prints one warning naming both versions and the fix. No line when the versions match or the project does not pin it.
