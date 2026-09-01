---
title: Getting started
description: Install StoryShelf and capture your first build.
---

StoryShelf is a self-hosted visual testing platform for Storybook. You run one server, point your CI at it, and review pixel diffs in the browser.

## 1. Scaffold a server

Use the CLI to create a new server project:

```bash
npx @storyshelf/cli create
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

## 3. Create a project and token

```bash
npx @storyshelf/cli init --url http://localhost:3000 --name "My Design System"
```

This prints a project `slug` and a CI token. Keep the token secret.

## 4. Upload a build from CI

```bash
npx @storyshelf/cli upload \
  --url http://localhost:3000 \
  --slug my-design-system \
  --token shelf_xxx \
  --sha "$GITHUB_SHA" \
  --branch "$GITHUB_REF_NAME"
```

StoryShelf renders every story server-side and diffs it against the branch baseline.

## 5. Review

Open the build review page, approve or reject changed stories, and merge when the status check goes green.
