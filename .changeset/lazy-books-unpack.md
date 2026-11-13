---
"@storyshelf/core": patch
---

Changed: capture, shards and retries read a published Storybook from its manifest, not from the zip (#859)

A build that has a `storybook/manifest.json` is now rebuilt in scratch from the manifest and the shared `content/<hash>` blobs (read with bounded concurrency, hash-checked, with the same path rules as zip extraction) instead of unzipping `storybook.zip` again for capture and for every shard. The tree is built beside its place and renamed in whole, so another copy of the process never reads a half-written one, and a retry on the same host reuses a complete tree. A build without a manifest still falls back to the zip.
