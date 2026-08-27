---
title: Getting started
description: Install StoryShelf and capture your first build.
---

StoryShelf is a self-hosted visual testing platform for Storybook. You run one server, point your CI at it, and review pixel diffs in the browser.

The CLI is published as `@storyshelf/cli`. Install it globally to get a `storyshelf` command, or prefix every invocation with `npx @storyshelf/cli`:

```bash
npm install -g @storyshelf/cli   # then: storyshelf serve ...
# or, without installing:
npx @storyshelf/cli serve --port 3000
```

## 1. Run the server

The easiest way is Docker:

```bash
docker run -p 3000:3000 -v storyshelf-data:/app/data storyshelf serve
```

Or run the CLI directly:

```bash
npx @storyshelf/cli serve --port 3000 --data-dir ./data
```

## 2. Create a project and token

```bash
npx @storyshelf/cli init --url http://localhost:3000 --name "My Design System"
```

This prints a project `slug` and a CI token. Keep the token secret.

## 3. Upload a build from CI

```bash
npx @storyshelf/cli upload \
  --url http://localhost:3000 \
  --slug my-design-system \
  --token shelf_xxx \
  --sha "$GITHUB_SHA" \
  --branch "$GITHUB_REF_NAME"
```

StoryShelf renders every story server-side and diffs it against the branch baseline.

## 4. Review

Open the build review page, approve or reject changed stories, and merge when the status check goes green.
