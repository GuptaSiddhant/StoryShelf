---
title: "@storyshelf/cli"
description: Client-only CLI package — install, config schema, and programmatic usage.
---

> **User guide:** For step-by-step CLI usage with examples, see the [CLI guide](/guides/cli/).

`@storyshelf/cli` provides the `storyshelf` binary for CI pipelines. It is **client-only** — no Playwright, no server dependencies, installs cleanly in CI.

## Install

```sh
nub add storyshelf
```

or

```sh
npm install -g storyshelf
```

- [npm package](https://www.npmjs.com/package/storyshelf) — install tarballs and version history.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/cli) — package directory on `main`.

## Config schema

Client config written to `.storybook/storyshelf.json`:

```json
{
  "slug": "string (required)",
  "url": "string (optional)",
  "buildDir": "string (default: storybook-static)",
  "buildCommand": "string (optional, mutually exclusive with buildScriptName)",
  "buildScriptName": "string (default: build-storybook)",
  "skip": "string (optional, glob pattern to skip upload)",
  "affectedOnly": "boolean (default: true, render only impacted stories)"
}
```

Validation: `zod` schema with `refine` for mutual exclusivity. Upload flags `--full`, `--untraced`, and `--stats-file` tune [affected capture](/concepts/affected-capture/) per run.

## Programmatic use

The CLI is designed for shell use. For programmatic access, use the REST API directly (`/api/v1` endpoints) or the `@storyshelf/core` models.

## How it fits

The CLI talks to the server's `/api/v1` endpoints. To start the server, use `storyshelf server init` to scaffold a new project, or see the [Deployment guide](/guides/deployment/).