---
"@storyshelf/core": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
---

Internal: add the git connection and repository link tables (epic #1117)

New `git_connections` and `git_repository_links` tables in every dialect, their core row types, a
`GitRepositoryLinkModel` whose uniqueness also counts the per-project git channels, the
`git_link_any_repository` site setting key (default off), and `git_connections.secret_encrypted` in
secret rotation. Nothing reads them yet.

Schema: expand only. Two new tables and their indexes; nothing is dropped, renamed or narrowed.
