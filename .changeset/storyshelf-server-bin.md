---
"@storyshelf/app": minor
"storyshelf": minor
---

Breaking: instance commands move to the `storyshelf-server` bin of `@storyshelf/app`

`storyshelf-server` runs `serve` (`--watch`), `migrate`, `purge`, `check-storage` and `doctor`. The instance module default-exports `defineShelfInstance(async (env) => options, { afterSetup })`, a new public export of `@storyshelf/app`; a module that exports a constructed app is refused. The bin loads `.env`, refuses renamed settings, calls the factory and creates the app with `createShelfApp(options, { mode })`: `serve` (default), `migrate` (the database's setup only) or `tool` (no setup, consumer, timers, git-link sync or replay). `purge`, `check-storage` and `doctor` run as `tool` and never migrate; `doctor` reports the schema level. The module is found by `--entry`, `package.json#storyshelf.server` or the usual names; the bin never reads `.storybook/storyshelf.json`. `createShelfApp(options)` stays public and defaults to `serve`.

`storyshelf server serve`, `storyshelf server check-storage` and `storyshelf purge` are removed with no alias or stub (owner policy #1309). `storyshelf server init` now writes a definition module, no `@hono/node-server` dependency, a `storyshelf.server` entry in `package.json`, and `start`/`dev` scripts and a Docker `CMD` that call `storyshelf-server`.

Schema: none.
