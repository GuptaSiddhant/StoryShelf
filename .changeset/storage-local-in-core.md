---
"@storyshelf/core": minor
"storyshelf": minor
---

Breaking: @storyshelf/storage-local is removed; import @storyshelf/core/storage/local

`createLocalStorage` moves to `@storyshelf/core/storage/local` with the same factory and options, and
core's `exports` map gains that subpath. `storyshelf server init` imports it from core and no longer
lists `@storyshelf/storage-local`. The `@storyshelf/storage-local` package is not published again and
leaves no re-export (ADR 0049 amendment, 2026-11-21); the owner deprecates it on npm with a message
naming the new path. Schema: none.
