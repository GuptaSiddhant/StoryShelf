# @storyshelf/cli

The StoryShelf command-line interface (binary `storyshelf`): start the server, create projects and CI tokens, upload built Storybooks as builds, purge expired builds, and retry failed builds.

## Install

```sh
nub add @storyshelf/cli
```

or

```sh
npm install @storyshelf/cli
```

## Quick start

Start the server:

```sh
storyshelf serve -p 3000 --data-dir ./data --secret <s> \
  --capture-concurrency 2 --purge-ttl-days 30
```

Create a project and a CI token:

```sh
storyshelf init --url https://shelf.example.com --name my-app
```

## API

### Commands

`storyshelf serve` — start the StoryShelf server.

```sh
storyshelf serve [-p <port>] [--data-dir <dir>] [--secret <secret>] \
  [--capture-concurrency <n>] [--purge-ttl-days <n>]
```

Defaults: `--port 3000`, `--data-dir ./data`, `--capture-concurrency 2`, `--purge-ttl-days 30`.

`storyshelf init` — create a project and CI token on a server.

```sh
storyshelf init --url <url> --name <name>
```

`storyshelf upload` — upload a built Storybook as a build.

```sh
storyshelf upload --url <url> --slug <slug> --token <token> \
  --sha <sha> --branch <branch> \
  [--storybook-dir storybook-static] [--message <msg>] \
  [--author-email <email>] [--author-name <name>]
```

The default `--storybook-dir` is `storybook-static`.

`storyshelf purge` — purge expired builds.

```sh
storyshelf purge --url <url>
```

`storyshelf retry` — retry a failed build.

```sh
storyshelf retry --url <url> --slug <slug> --build-id <id>
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
          --url https://shelf.example.com \
          --slug my-app \
          --token "${{ secrets.STORY_SHELF_TOKEN }}" \
          --sha "${{ github.sha }}" \
          --branch "${{ github.ref_name }}" \
          --message "${{ github.event.head_commit.message }}"
```

## How it fits in

`cli` is the entry point operators and CI pipelines use to talk to a running StoryShelf server. `serve` assembles the full stack from `@storyshelf/core`, `@storyshelf/db-sqlite`, and `@storyshelf/storage-local`; `init`, `upload`, `purge`, and `retry` drive the JSON API under `/api/v1`.

See `docs/architecture.md` for the capture workflow and `docs/testing.md` for the gated browser integration suite.
