---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Changed: reclaim per-build Storybook copies left from before published files were stored once (#850)

Builds published between #301 and #849 hold a full copy of their files under `storybook/` next to a `manifest.json`, although the same bytes are in `content/`. The daily retention sweep now deletes each copy whose content blob exists, in pages of 50 builds (up to 20 pages a sweep), resuming from a cursor saved in `site_settings`. It keeps the manifest, keeps any copy whose blob is missing, never touches a build without a manifest, and records the build's content uses first so a collector cannot free a blob a build still serves. It is not a boot task and adds no job kind.
