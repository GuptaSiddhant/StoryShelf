---
"@storyshelf/app": patch
"@storyshelf/core": patch
---

Changed: drop storybook.zip once a build has a manifest, and capture from the content store (#850)

A publish that ends with a committed manifest and recorded content uses now deletes the build's upload zip; a failed or partial publish keeps it, so its retry can still extract. The daily retention sweep gets a second pass (own cursor, batched, idempotent, no new job kind) that deletes the zips of existing builds that hold a manifest, skipping `pending` builds and any whose content is missing or being collected. Capture, shards and retries already build their scratch directory from the manifest and `content/` (once per build per host); a blob the manifest names that is gone now fails the capture with an error naming its content hash, with no fallback. The upload zip of a build with a manifest is no longer readable afterwards.
