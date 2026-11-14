---
"@storyshelf/storybook-addon": patch
---

Added: the addon accepts the `skipped` build status (ADR 0044)

The build-status list the addon validates against gains `skipped`, so a project whose latest build was skipped still gets a badge instead of none.
