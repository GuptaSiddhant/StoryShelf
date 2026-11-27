---
title: Set up with an AI agent
description: Hand StoryShelf setup to a coding agent with a task to paste, an AGENTS.md snippet for your repository, and the files agents read.
---

A coding agent (Claude Code, Cursor, Codex and the like) can do the repetitive part of setting up StoryShelf in a repository: find the Storybook, write the client config, check the connection and add the CI step. This page gives you the task to paste, a snippet for your repository's `AGENTS.md`, and the files the docs publish for agents.

## What agents read

Every page of this site is also available as Markdown at its URL plus `index.md` (each page links to it from its `<head>`, and has a **Copy page as Markdown** button). For whole-docs context:

| File               | Contents                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| `/llms.txt`        | An index of every page, one line each                                    |
| `/llms-start.txt`  | Start here, Concepts and the CLI: enough to set Shelf up in a repository |
| `/llms-deploy.txt` | Deployment and operations                                                |
| `/llms-api.txt`    | The REST API guides, the webhooks guide and the MCP server page          |
| `/llms-full.txt`   | Everything above in one file (large; the changelog is left out)          |
| `/openapi.json`    | The REST API as an OpenAPI 3 document                                    |

Each file starts with the StoryShelf version it describes. If the server you run is older or newer, trust the CLI's `--help` over the docs.

## A task to paste

Give this to your agent from the repository root. Fill in the server URL and project slug, or delete those lines if you have no server yet and want it to ask you.

```text
Set up StoryShelf visual testing for this repository.

1. Read https://storyshelf.js.org/llms-start.txt first. It is the documentation for this task.
2. Use the package manager this repository already uses (look at the lockfile). Do not
   switch package managers or add a second lockfile.
3. Run the client CLI with that package manager's runner (for example `npx storyshelf`,
   `pnpm dlx storyshelf` or `yarn dlx storyshelf`) and run `storyshelf init` to write
   .storybook/storyshelf.json. Server URL: <your server URL>. Project slug: <your slug>.
4. Run `storyshelf doctor` and fix what it reports, or tell me what you cannot fix.
5. Add an upload step to my CI as the docs describe (the CI setup page). Read the token
   from the CI secret SHELF_TOKEN.
6. Never commit a token or any other secret. Do not put one in storyshelf.json, a workflow
   file, a script or a log. If you need a token, ask me to create one in Project settings.
7. Do not approve, reject or accept any build. Tell me what you changed and what I need to do.
```

The steps use only commands the [client CLI](/guides/cli/client/) has today.

## A snippet for your repository's AGENTS.md

Add this to the `AGENTS.md` (or `CLAUDE.md`) of the repository that is tested with StoryShelf, so agents keep using it correctly in later sessions.

```markdown
## Visual testing (StoryShelf)

- Visual tests run on a StoryShelf server. The client config is `.storybook/storyshelf.json`;
  the token is the `SHELF_TOKEN` environment variable. Never write a token to a file,
  commit it or print it.
- Run `storyshelf doctor` to check the setup and `storyshelf whoami` to see which server and
  project this repository uses. Run `storyshelf build` to build the Storybook without
  uploading, and `storyshelf upload --dry-run` to validate an upload without sending anything.
- CI uploads a build for each push (`storyshelf upload`). Do not run a real upload from a
  local session unless asked to; it creates a build on the shared server.
- Docs for agents: https://storyshelf.js.org/llms.txt. The REST API is described at
  https://storyshelf.js.org/openapi.json.
- If the StoryShelf MCP server is configured, use it to read builds, changed snapshots, capture
  logs and AI triage, and to comment on a review. It cannot approve anything.
- Approving or rejecting a build is a human decision. Never approve a build, work around a
  failed visual check, or change a project's review settings to make a check pass. When a
  check fails, explain which stories changed and leave the verdict to the reviewer.
```

## Scaffolding a server without a terminal

An agent has no interactive terminal, so `create-storyshelf` stops with a message unless it is given `--yes` (`-y`). That takes every default (SQLite, local filesystem, local accounts, no Docker files) and asks nothing:

```sh
npm create storyshelf my-storyshelf -- --yes
```

The first argument is the directory; without one the project is `my-storyshelf`. The scaffolded server needs Node 24 or newer and stops with one line, exit 1, on an older Node.

## The MCP server

To let an agent read builds and comment on reviews, set up the [MCP server](/ai/mcp/). It has no approve or reject tool, which matches the snippet above.

## Next steps

- [Getting started](/guides/getting-started/) is the same setup for a person.
- [CI setup](/guides/ci/) has the upload step for your CI provider.
- [Troubleshooting](/guides/troubleshooting/) covers what `storyshelf doctor` reports.
