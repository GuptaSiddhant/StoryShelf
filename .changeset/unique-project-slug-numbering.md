---
"@storyshelf/core": patch
---

Fixed: a third project with the same name no longer reuses the slug `name-2`

`ProjectModel.create` looked only for the bare slug, so once `test` existed every later project named "Test" was given `test-2` and the insert failed on the unique slug index. It now reads the numbered slugs too and takes the first free suffix.
