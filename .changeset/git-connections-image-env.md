---
"storyshelf": minor
---

Changed: the image and the Terraform modules read server-wide git connections from configuration

The server image reads `gitFromEnv(env)` at start: a GitHub App from `SHELF_GITHUB_APP_ID` and
`SHELF_GITHUB_APP_PRIVATE_KEY` (or `…_FILE`), a GitLab token from `SHELF_GITLAB_TOKEN` (or `…_FILE`)
and `SHELF_GITLAB_TOKEN_EXPIRES`, and more from `SHELF_GIT_CONFIG_FILE`. A half-set connection stops
the server and names the variable, never its value. The AWS, GCP and Azure Terraform modules gain
optional `github_app_id`, a secret-manager reference for the App private key and the GitLab token
(never a value, so nothing reaches state) and `gitlab_token_expires`; with none set nothing changes.
Schema: none.
