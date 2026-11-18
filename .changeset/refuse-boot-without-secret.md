---
"@storyshelf/auth": patch
"@storyshelf/app": patch
"storyshelf": patch
---

Security: never start with sign-in configured and no valid SECRET

`createShelfAuth` now refuses a `secret` that is unset or shorter than 32 characters when it is called, so the auth library never falls back to its built-in default secret. It also refuses to start while `BETTER_AUTH_SECRETS` is set, since the library would sign with that instead of `SECRET`. `app.lifecycle.setup()` now throws when a boot check (auth secret, AI, images) failed, instead of logging `boot check setup failed` and letting the server listen; the error names the cause. The container image turns sign-in on by default: it refuses to start without `AUTH_PASSWORD` and a valid `SECRET`, and runs with every route open only when `SHELF_AUTH=none` is set, logging a warning because it listens on all addresses. The `storyshelf server init` compose file reads `SECRET` from the environment instead of a placeholder. The AI data purge now runs after the database migrations. The dev and Fly servers refuse `AUTH_PASSWORD` without a valid `SECRET` instead of turning auth off. Upgrading: an image started with no variables must now set `AUTH_PASSWORD` and `SECRET`, or `SHELF_AUTH=none`.
