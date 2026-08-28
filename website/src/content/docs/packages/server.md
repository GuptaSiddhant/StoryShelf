---
title: "@storyshelf/server"
description: The self-hosted StoryShelf server — review UI, SQLite, storage, and capture, assembled in one process.
---

`@storyshelf/server` provides the `storyshelf-server` binary: the self-hosted StoryShelf server. It is the **assembly point** — it wires `@storyshelf/core`, `@storyshelf/db-sqlite`, and `@storyshelf/storage-local`, serves the review UI, and injects a `CaptureRunner` supplied by a separate runner package (`@storyshelf/runner-playwright` today). The runner is swappable, so a future alternative (e.g. a remote capture fleet) plugs in here without touching the router or pipeline.

## Install

```sh
nub add @storyshelf/server
```

## Start a server

`serve` is the default command, so either of these starts the server:

```sh
storyshelf-server serve -p 3000 --data-dir ./data --secret <secret> \
  --capture-concurrency 2 --purge-ttl-days 30
```

```sh
storyshelf-server -p 3000 --data-dir ./data
```

Defaults are port `3000`, data directory `./data`, capture concurrency `2`, and a 30-day purge TTL. The server uses SQLite and local storage by default, and captures in-process via `@storyshelf/runner-playwright`.

## How it fits

Client commands (`init`, `upload`, `retry`, `purge`) live in `@storyshelf/cli`, which carries no Playwright or router dependencies and talks to this server over `/api/v1`. The Playwright renderer itself lives in `@storyshelf/runner-playwright`.