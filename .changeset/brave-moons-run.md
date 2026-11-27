---
"@storyshelf/app": patch
---

Fixed: first-run copy names one button, drops pricing, doctor no longer sends new users to migrate

The home page, the projects page and the "Set up your first upload" card all say "New project". The empty projects page no longer says projects are free and unlimited. With no `schema_meta` row, `storyshelf-server doctor` passes and says the database will be migrated on the first `serve` or by `storyshelf-server migrate`; it warns only when the database is unreachable. Schema: none.
