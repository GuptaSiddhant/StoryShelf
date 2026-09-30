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

const app = createShelfApp({ database, storage, notifiers: chatNotifiers });
```

## Subpaths

Each provider is importable on its own (root aggregates all three):

```ts
import { slackWebhookNotifier } from "@storyshelf/notify-chat/slack";
import { teamsWorkflowNotifier } from "@storyshelf/notify-chat/teams";
import { logNotifier } from "@storyshelf/notify-chat/log";
```

Project admins then add channels (`slack-webhook`, `teams-workflow`, `log`) with an event filter and display toggles. Webhook URLs are channel secrets (AES-256-GCM at rest, decrypted in memory at send time). See [Notifications](/guides/notifications/).
