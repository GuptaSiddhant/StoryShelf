---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Changed: reclaim per-build Storybook copies left from before published files were stored once (#850)

Builds published between #301 and #849 hold a full copy of their files under `storybook/` next to a `manifest.json`, although the same bytes are in `content/`. A new `statics-reclaim` job, queued by the daily retention sweep, deletes each copy whose content blob exists, a page of builds at a time, and resumes from a saved cursor. It keeps the manifest, keeps any copy whose blob is missing, never touches a build without a manifest, and records the build's content uses first so a collector cannot free a blob a build still serves. It runs only on hosts that poll the job queue (not serverless), never at boot.
