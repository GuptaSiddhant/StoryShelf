---
"storyshelf": patch
"@storyshelf/app": patch
---

Fixed: the scaffolded server starts and says what it needs

`server init` now preselects local accounts, writes `.env.example`, a README and `.gitignore`, names `SECRET`, `PUBLIC_BASE_URL` and `AUTH_PASSWORD` in its next steps, and the scaffold stops with one line naming any variable that is unset. It also reads `.env`, passes `PUBLIC_BASE_URL` and the admin token into `config`, and pins `@hono/node-server` to `^2.1.11` (GHSA-rmxm-3fg6-px4f). `server init` without a terminal exits 1 and says why, and `--dir` is honoured. `create` no longer prints a raw git `fatal:` line. The first `app.lifecycle.setup()` waits for the eager boot run instead of running every adapter hook a second time. `create` on a server with sign-in on creates the project but no longer mints a token that cannot upload; it prints the project's page, where "Get your first build" creates one. Without sign-in it works as before.
