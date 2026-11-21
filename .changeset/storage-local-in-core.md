---
"@storyshelf/core": minor
"storyshelf": minor
"@storyshelf/storage-local": minor
---

Changed: local storage is built into core as `@storyshelf/core/storage/local`

`createLocalStorage` moves to `@storyshelf/core/storage/local` with the same factory and options, and
core's `exports` map gains that subpath. `storyshelf server init` imports it from core and no longer
lists `@storyshelf/storage-local`. `@storyshelf/storage-local` is deprecated: it re-exports the core
subpath for one minor release, then is no longer published. Schema: none.
