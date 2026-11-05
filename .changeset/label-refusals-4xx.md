---
"@storyshelf/app": patch
"@storyshelf/core": patch
---

Two label-type refusals no longer answer a server error. A create that loses a race for the same key (two requests at once; the unique index turns the second away) now answers `409` with "A label type with the key '…' already exists", like the sequential duplicate, instead of `500`. Deleting a reserved label type through `DELETE /api/v1/projects/{slug}/label-types/{key}` now answers `400` with "Label type '…' cannot be removed", instead of `500`. Both responses are declared in the OpenAPI document.
