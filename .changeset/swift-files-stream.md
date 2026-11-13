---
"@storyshelf/app": patch
"@storyshelf/core": patch
"@storyshelf/storage-local": patch
---

Changed: published Storybook files are served with one storage read

A build's manifest is cached in memory (a bounded LRU per storage adapter, never for a missing manifest), the `exists` calls before a read are gone (a miss is the adapter's not-found, recognised by `isStorageNotFound`), and a file with no gzip copy is streamed instead of buffered. The local adapter's `readStream` now fails with `ENOENT` for a missing object.
