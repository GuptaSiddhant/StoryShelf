---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Security fix: content hashes sent to the file-by-file upload routes (`dedup`, `manifest`, `content`) are now checked to be 64 lowercase hex digits before they are used. Before, any string became part of the storage key `content/<hash>`, so with the local storage adapter a hash such as `../<other project>/…` could overwrite files of another project and the dedup route could be used to probe for them. A malformed hash now answers `400` before any storage call, and every `content/…` key is built by one validating `contentKey` helper. Nothing changes for the CLI, which already sends SHA-256 hex digests.
