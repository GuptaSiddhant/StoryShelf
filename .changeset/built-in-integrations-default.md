---
"@storyshelf/app": minor
"storyshelf": minor
---

Breaking: notification and Figma integrations are built in; the separate packages are deprecated

Git, chat (Slack, Teams), email and Figma are now registered by default (ADR 0049) and send nothing until a project configures them. `storyshelf server init` no longer generates imports or installs for `@storyshelf/notify-git`, `@storyshelf/notify-chat`, `@storyshelf/notify-email` or `@storyshelf/design-figma`, and installs `nodemailer` only when you choose SMTP. The dev server and the Fly demo use the defaults.

Migration:

1. Remove `@storyshelf/notify-git`, `@storyshelf/notify-chat`, `@storyshelf/notify-email` and `@storyshelf/design-figma` from `package.json`.
2. Delete `notifications: { notifiers: [...] }` and `design: [createFigmaDesign()]` from `createShelfApp`. An array still means exactly these providers with no built-ins, so leaving it in keeps the old behaviour.
3. To send email through SMTP, swap the built-in `email` notifier with the function form: `notifiers: (builtIn) => builtIn.map((p) => p.metadata.kind === "email" ? createEmailNotifier(sender) : p)`, with `createEmailNotifier` and `smtpPresetFromEnv` from `@storyshelf/core/integrations`, and install `nodemailer`.
4. Import anything else these packages exported from `@storyshelf/core/integrations`.

The `server init` git and Figma questions are gone. The packages stay published for one minor release as re-exports of core.
