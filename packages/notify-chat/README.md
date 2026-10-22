# @storyshelf/notify-chat

Chat notification providers for StoryShelf: formatted build and admin alerts over Slack and Teams incoming webhooks (plus a log provider for tests/dev). Zero runtime dependencies — all sends go through `@storyshelf/core/utils` (`httpText`: timeout + retry with `Retry-After`).

## Install

```sh
nub add @storyshelf/notify-chat
```

## Quick start

```ts
import { createShelfApp } from "@storyshelf/app";
import { chatNotifiers } from "@storyshelf/notify-chat";

const app = createShelfApp({ database, storage, notifications: { notifiers: chatNotifiers } });
```

## Subpaths

Each provider is importable on its own (root aggregates all three):

```ts
import { slackWebhookNotifier } from "@storyshelf/notify-chat/slack";
import { teamsWorkflowNotifier } from "@storyshelf/notify-chat/teams";
import { logNotifier } from "@storyshelf/notify-chat/log";
```

## Providers

| Provider kind    | Posts to                       | Use for                                   |
| ---------------- | ------------------------------ | ----------------------------------------- |
| `slack-webhook`  | A Slack incoming webhook URL   | Build and admin alerts in a Slack channel |
| `teams-workflow` | A Teams workflow (webhook) URL | The same, in Microsoft Teams              |
| `log`            | The server log                 | Tests and local development               |

## Channels

Providers only make a kind _available_. Project admins then add **channels** of that kind — in **Settings → Notifications** or via the API — each with an event filter and display toggles. A webhook URL is a channel secret: it is encrypted at rest (AES-256-GCM) and decrypted in memory only when a message is sent.

See [Notifications](https://storyshelf.js.org/guides/notifications/) for channels, subscriptions, and the events you can subscribe to.
