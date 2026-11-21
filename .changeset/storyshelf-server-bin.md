---
"@storyshelf/app": minor
"storyshelf": minor
---

Breaking: instance commands move to the `storyshelf-server` bin of `@storyshelf/app`

`storyshelf-server` runs `serve`, `migrate`, `purge`, `check-storage` and `doctor` against the instance's own module and environment (it reads no `.storybook/storyshelf.json`). `serve` uses `startServer` from `@storyshelf/app/node`; `purge` and `check-storage` run in-process with `SHELF_ADMIN_TOKEN`. `--help`, `--version` and argument errors load no adapter.

`storyshelf server serve`, `storyshelf server check-storage` and `storyshelf purge` are removed with no alias or stub (owner policy #1309). `storyshelf server init` now scaffolds an `src/index.ts` that exports the app, with `start` and `dev` scripts and a Docker `CMD` that call `storyshelf-server serve`.

Schema: none.
