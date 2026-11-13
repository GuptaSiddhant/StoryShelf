---
"@storyshelf/core": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
"@storyshelf/app": patch
---

Changed: list queries read only the columns they show

`ListOptions` takes an optional `columns` selection that every database adapter honours. Snapshot and build lists on the library, component and review paths no longer read `a11y_violations` or `test_results`; single-row reads stay full.
