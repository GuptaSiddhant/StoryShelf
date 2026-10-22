---
title: Common setups
description: Short paths for the most common ways to set up StoryShelf, from a ten-minute trial to a required pull-request check, a monorepo or serverless hosting.
---

Each entry here is the shortest route to one goal, with a link to the full guide. If you have not set up StoryShelf yet, begin with [Getting started](/guides/getting-started/).

## Try it on your machine

Scaffold a server, start it, and create a project from your Storybook folder. The default is SQLite and local disk, with no authentication, so there is nothing else to run.

```sh
npx storyshelf server init
```

Then follow [Getting started](/guides/getting-started/): start the server, run `storyshelf init` in your Storybook, and upload a build. To see a finished instance first, open the [live demo](/guides/demo/).

## Run it on one server

Use Docker Compose with Postgres and local disk, and put HTTPS in front of it. Set a strong `SECRET` and turn on authentication before sharing it. See [Docker Compose](/guides/deployment/docker-compose/), [Security and data handling](/guides/security/) and [Sizing and cost](/guides/sizing/).

## Block pull requests until the visual review is approved

1. Upload a build for the pull request's head commit from CI, passing `--sha` and `--branch` ([CI setup](/guides/ci/)).
2. Add a git channel on the project (**Settings → Notifications**) for GitHub or GitLab. On GitHub you can use a GitHub App so StoryShelf posts check runs with one annotation per changed story.
3. Require the status in branch protection, or let StoryShelf set the rule for you.

All three steps, including `storyshelf protect`, are in [Merge gate setup](/guides/merge-gate/).

## Several Storybooks in one repository

One project is one Storybook. Keep one `.storybook/storyshelf.json` per Storybook, each with its own `slug`, and upload each from its own folder. When they share a repository, give each project's git channel a different `prefix` (for example `storyshelf-web` and `storyshelf-docs`) so their statuses do not collide and each can be required on its own. See [Monorepo](/guides/config/#monorepo) and [Several projects in one repo](/guides/merge-gate/#several-projects-in-one-repo).

## Publish Storybooks without testing them

Leave the `testing` option out and StoryShelf hosts Storybooks only: no capture, no baselines, no browser to install.

```ts
createShelfApp({ database, storage });
```

Designers and product managers get a link to the latest Storybook of each branch, and builds on feature branches can still be approved or rejected without screenshots. See [Hosting only](/concepts/hosting-only/) and [Published Storybook](/concepts/publishing/).

## Host it on a serverless platform

A serverless platform cannot run capture, but it can host Storybooks. Use a serverless-friendly database and object storage, such as Turso with S3, and upload large builds file by file (the CLI does this on its own when the server answers `413`). See [Hosting only](/concepts/hosting-only/#serverless-platforms) and [Deployment targets](/packages/core/#deployment-targets).

## Capture in more browsers

Chromium is the default. List the engines you want on the runner, and every project can then pick from them, each with its own baselines.

```ts
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

createPlaywrightCaptureRunner({ browsers: ["chromium", "firefox", "webkit"] });
```

Install the browsers on the host first. See [@storyshelf/runner-playwright](/packages/runner-playwright/#browsers).

## Render in browsers on other machines

To keep browsers off the app host, or to reach a private network, list a remote browser (a self-hosted Playwright server, Azure Playwright Workspaces or a hosted service). See [Remote browsers](/guides/remote-browsers/).

## Make large Storybooks faster

Three levers, in the order to try them: [affected capture](/concepts/affected-capture/) renders only the stories a change touches (it needs full git history in CI); a bigger host or more instances adds capacity ([Sizing and cost](/guides/sizing/)); and `testing.shardSize` splits a very large build across instances ([Sharding big builds](/concepts/capture/#sharding-big-builds)).

## Let your team sign in

Local accounts work with no identity provider: an admin invites each person with a one-time link. For an identity provider, StoryShelf supports social login (GitHub, GitLab, Google, Microsoft, Cognito), OIDC (Keycloak, Okta, Auth0, Entra), SAML and passkeys. Choose in [Authentication](/guides/auth/), then set project roles in [Roles & tokens](/concepts/roles/).

## Get alerts in Slack, Teams or email

Add a channel on the project (**Settings → Notifications**) and pick which events it receives. Chat channels use an incoming-webhook URL; email needs an SMTP or HTTP mail transport. Notifications need a confirmed public URL. See [Notifications](/guides/notifications/), [@storyshelf/notify-chat](/packages/notify-chat/) and [@storyshelf/notify-email](/packages/notify-email/).

## Link stories to their Figma designs

Register the Figma provider on the server and stories can link to their Figma designs, with previews and a warning when a design changes after the story. See [Design links](/guides/design-links/) and [@storyshelf/design-figma](/packages/design-figma/).

## Back up or move baselines

Export a project's baselines as a zip and import them into any StoryShelf instance, for a backup, a move between servers, or promoting staging to production. See [Baseline portability](/guides/portability/).

## Move from Chromatic or Lost Pixel

See [Migrating from Chromatic](/guides/chromatic-migration/) and [Migrating from Lost Pixel](/guides/lost-pixel-migration/), and the [comparison](/guides/chromatic-comparison/) if you are still deciding.

## Let an AI agent read your builds

The [MCP server](/ai/mcp/) lets tools such as Claude Code and Cursor read builds, diffs and AI triage and add review comments, using a token you control. It never approves or rejects. For AI-written summaries inside StoryShelf itself, see [AI insights](/ai/).

## Something not working?

See [Troubleshooting and FAQ](/guides/troubleshooting/).
