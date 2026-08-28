# @storyshelf/server

The self-hosted StoryShelf server (binary `storyshelf-server`): the review UI, SQLite, storage, and the capture pipeline, all in one process. It is the **assembly point** — it wires `@storyshelf/core`, `@storyshelf/db-sqlite`, and `@storyshelf/storage-local`, and injects a `CaptureRunner` implementation supplied by a separate runner package (`@storyshelf/runner-playwright` today).

## Install

```sh
nub add @storyshelf/server
```

or

```sh
npm install @storyshelf/server
```

## Quick start

```sh
storyshelf-server serve -p 3000 --data-dir ./data --secret <s> \
  --capture-concurrency 2 --purge-ttl-days 30
```

`serve` is the default command, so `storyshelf-server` with no arguments does the same thing.

## API

### Commands

`storyshelf-server serve` — start the StoryShelf server, assembling `@storyshelf/core`, `@storyshelf/db-sqlite`, and `@storyshelf/storage-local`, and running the `@storyshelf/runner-playwright` capture pipeline in-process.

```sh
storyshelf-server serve [-p <port>] [--data-dir <dir>] [--secret <secret>] \
  [--capture-concurrency <n>] [--purge-ttl-days <n>]
```

Defaults: `--port 3000`, `--data-dir ./data`, `--capture-concurrency 2`, `--purge-ttl-days 30`.

## How it fits in

The client verbs (`init`, `upload`, `purge`, `retry`) live in `@storyshelf/cli`, which talks to this server's `/api/v1` endpoints and carries no Playwright or router dependencies. The server pulls the router stack and the default runner (`@storyshelf/runner-playwright`) — keeping `@storyshelf/cli` installable in CI without browsers. The runner is swappable: a future alternative (e.g. a remote runner) implements the same `CaptureRunner` interface and is wired in here.

See `docs/architecture.md` for the capture workflow and `docs/testing.md` for the gated browser integration suite.