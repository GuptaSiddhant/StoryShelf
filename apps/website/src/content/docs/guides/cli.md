---
title: CLI
description: StoryShelf CLI overview — client and server commands.
---

> **Package reference:** For technical details see [@storyshelf/cli](/packages/cli/).

The StoryShelf CLI (`storyshelf`) exposes a `storyshelf` binary for CI pipelines. Install it globally or via `npx`:

```bash
npm install -g storyshelf
# or
npx storyshelf --help
```

:::note
The CLI is **client-only** — it talks to a running server over `/api/v1` and carries no Playwright. To scaffold a server, use `storyshelf server init` (see [Server CLI](/guides/cli/server/)).
:::

This section is now split for readability:

- [Client — init, create, upload, build, doctor, whoami, retry, purge](/guides/cli/client/)
- [Server — server init, server serve](/guides/cli/server/)
- [Configuration — .storybook/storyshelf.json, flags, env, monorepo](/guides/config/)

Every command's full flags and examples live on its page; the package reference stays at [@storyshelf/cli](/packages/cli/).

## Quick links

| Area | Page |
|------|------|
| Client | [init / create / upload / build / doctor / whoami / retry / purge](/guides/cli/client/) |
| Server | [server init / server serve](/guides/cli/server/) |
| Config | [config file, env, monorepo](/guides/config/) |
