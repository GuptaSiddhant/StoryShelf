---
"@storyshelf/core": minor
---

Added: server-wide git connections: a stored model, configuration, GitHub App manifest and installation lookup

`GitConnectionModel` stores GitHub App and GitLab token connections with their secret encrypted
with `SECRET` and never returned. `ShelfOptions.git` declares connections and approved links in
code, with `githubApp(...)` and `gitlabGroup(...)` from `@storyshelf/core/integrations`, or from the
environment with `gitFromEnv(env)` (`SHELF_GITHUB_APP_ID`, `SHELF_GITHUB_APP_PRIVATE_KEY` or
`…_FILE`, `SHELF_GITHUB_API_URL`, `SHELF_GITLAB_HOST`, `SHELF_GITLAB_TOKEN` or `…_FILE`,
`SHELF_GITLAB_TOKEN_EXPIRES`, `SHELF_GIT_CONFIG_FILE`). A configured connection is never stored and
wins over a stored one with its id. New helpers build a GitHub App manifest, exchange its one-time
code, resolve the installation that covers a repository with the App's own JWT, and probe each
connection's health (a GitLab token warns 30 days before it expires). Nothing uses them yet
(epic #1117, ADR 0054).
