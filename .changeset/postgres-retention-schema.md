---
"@storyshelf/db-postgres": patch
---

The Postgres schema now has the build retention tables (`build_references`, `build_reference_generations`, `build_deletions`, `build_content_releases`) and `builds.retention_state`, created on a fresh database and added on upgrade. Nothing reads them yet; Postgres still reports no retention capability.
