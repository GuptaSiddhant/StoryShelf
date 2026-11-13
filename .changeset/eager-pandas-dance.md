---
"@storyshelf/app": patch
---

Added: show skipped builds, hidden by default, with a "Show skipped" filter and a page of their own

Builds skipped because no story changed (ADR 0044) get a neutral `skipped` badge. The builds list hides them until "Show skipped" is ticked, shows "No story changed since <sha>" with a link to the build they repeat, and the build page lists the source build, its Storybook while available, and the changed files. Part of #551.
