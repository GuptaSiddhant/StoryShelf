# @storyshelf/cli

The StoryShelf command-line interface (binary `storyshelf`): scaffold servers, initialize client config, create projects and CI tokens, upload built Storybooks as builds, purge expired builds, and retry failed builds. It talks to a running StoryShelf server over `/api/v1` and has **no Playwright or server dependencies**, so it installs cleanly in CI.

## Install

```sh
nub add @storyshelf/cli
```

or

```sh
npm install @storyshelf/cli
```

## Quick start

Initialize client config (requires `.storybook/main.*`):

```sh
storyshelf init --url https://shelf.example.com --slug my-app
# writes .storybook/storyshelf.json
```

Create a project on the server (requires site-admin token and `.storybook/main.*`):

```sh
storyshelf create --url https://shelf.example.com --name my-app --token $STORYSHELF_ADMIN_TOKEN
# prints slug + CI token and writes .storybook/storyshelf.json
```

Scaffold a server:

```sh
storyshelf server init --dir ./my-shelf
```

## API

### Commands

`storyshelf init` — initialize `.storybook/storyshelf.json` (client config). Fails if `.storybook/main.*` not found. Prompts if flags missing.

```sh
storyshelf init --url <url> --slug <slug> [--build-dir <dir> --build-command <cmd> --skip <glob> -c <config>]
```

`storyshelf create` — create a project and CI token on a server (requires admin token). Fails if `.storybook/main.*` not found and writes `.storybook/storyshelf.json`.

```sh
storyshelf create --url <url> --name <name> --token <admin-token>
# or env STORYSHELF_ADMIN_TOKEN / ADMIN_TOKEN
```

`storyshelf server init` — scaffold a new StoryShelf server project.

```sh
storyshelf server init --dir <dir>
```

`storyshelf upload` — upload a built Storybook as a build. `--url/--slug` optional when `.storybook/storyshelf.json` exists (flags > env > file). `--token/--sha/--branch` fallback to `STORYSHELF_TOKEN`/`GITHUB_SHA`/`GITHUB_REF_NAME`. Running `storyshelf` with no args defaults to `upload` if config exists, else shows help to run `init`.

```sh
storyshelf upload --url <url> --slug <slug> --token <token> \
  --sha <sha> --branch <branch> \
  [--build-dir <dir> --build-command <cmd> --force-build --skip <glob> -c <config>] [--message <msg>] \
  [--author-email <email>] [--author-name <name>]
```

The default `--build-dir` is `storybook-static` or `buildDir` from `.storybook/storyshelf.json` (see [Configuration](../../apps/website/src/content/docs/guides/config.md)). If `buildDir` is missing/empty, `upload` runs `buildCommand` or `npm run <buildScriptName>`.

`storyshelf purge` — purge expired builds (requires admin token when auth enabled).

```sh
storyshelf purge --url <url> [--token <admin-token>]
```

`storyshelf retry` — retry a failed build.

```sh
storyshelf retry --url <url> --slug <slug> --build-id <id> [--token <token>]
```

### Example CI snippet

```yaml
# .github/workflows/visual.yml
on:
  push:
  pull_request:

jobs:
  visual:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: nub install && nub run build
      - run: nubx storybook build -o storybook-static
      - run: nubx storyshelf upload \
          --token "${{ secrets.STORYSHELF_TOKEN }}" \
          --sha "${{ github.sha }}" \
          --branch "${{ github.ref_name }}"
          # --url/--slug from .storybook/storyshelf.json
```

## How it fits in

The server is scaffolded via `storyshelf server init`, which assembles `@storyshelf/core`, `@storyshelf/db-sqlite`, and `@storyshelf/storage-local` and runs Playwright captures. The CLI never imports that stack — client-only by design.

See `docs/architecture.md` for the capture workflow and `docs/testing.md` for the gated browser integration suite.
