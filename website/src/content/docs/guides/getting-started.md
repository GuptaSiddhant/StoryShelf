---
title: Getting started
description: Install StoryShelf and capture your first build.
---

StoryShelf is a self-hosted visual testing platform for Storybook. You run one server, point your CI at it, and review pixel diffs in the browser.

## 1. Scaffold a server

Use the CLI to scaffold a new server project:

```bash
npx @storyshelf/cli server init
# ? Project name: my-storyshelf
# ? Directory: ./my-storyshelf
# ? Which database? SQLite
# ? Which storage? Local filesystem
# ? Which auth? None
# ? Which git provider? GitHub
```

This generates `server.ts` + `package.json` with the correct adapters.

## 2. Start the server

```bash
cd my-storyshelf
npm install
npm start
```

## 3. Initialize Storybook and create a project

Ensure `.storybook/main.*` exists, then initialize client config and create a project (requires site-admin token when auth is enabled):

```bash
# writes .storybook/storyshelf.json (prompts if flags missing)
npx @storyshelf/cli init --url http://localhost:3000 --slug my-design-system

# or create remotely and write config in one step (requires STORYSHELF_ADMIN_TOKEN)
npx @storyshelf/cli create --url http://localhost:3000 --name "My Design System" --token $STORYSHELF_ADMIN_TOKEN
# → prints slug + CI token and writes .storybook/storyshelf.json
```

Keep the CI token secret (`STORYSHELF_TOKEN` env in CI). `create` and `init` fail if `.storybook/main.*` is not found.

## 4. Upload a build from CI

With `.storybook/storyshelf.json` present, `upload` flags can be omitted and `npx @storyshelf/cli` defaults to `upload`:

```bash
npx @storyshelf/cli upload \
  --token shelf_xxx \
  --sha "$GITHUB_SHA" \
  --branch "$GITHUB_REF_NAME"
# or simply (when config + env present):
npx @storyshelf/cli
```

Explicit flags still work:

```bash
npx @storyshelf/cli upload \
  --url http://localhost:3000 \
  --slug my-design-system \
  --token shelf_xxx \
  --sha "$GITHUB_SHA" \
  --branch "$GITHUB_REF_NAME"
```

StoryShelf renders every story server-side and diffs it against the branch baseline. Without `.storybook/storyshelf.json`, running `storyshelf` shows help to run `init`.

## 5. Review

Open the build review page, approve or reject changed stories, and merge when the status check goes green.
