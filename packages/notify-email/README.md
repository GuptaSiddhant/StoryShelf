# @storyshelf/notify-email

Email notification transport for StoryShelf: one SMTP/HTTP transport serves notification channels and (optionally) auth mail. Owns `nodemailer`; no other package imports it directly.

## Install

```sh
nub add @storyshelf/notify-email
```

## Quick start

```ts
import { createShelfApp } from "@storyshelf/app";
import { createShelfAuth } from "@storyshelf/auth";
import { createEmailNotifier, smtpPreset } from "@storyshelf/notify-email";

const sender = smtpPreset({ host: "mail.example.com", port: 587, from: "shelf@example.com" });
const app = createShelfApp({
  database,
  storage,
  notifiers: [createEmailNotifier(sender, { from: "shelf@example.com" })],
  // Optional: invites and password resets share the same transport.
  // auth: createShelfAuth({ db, secret, baseURL, emailSender: sender }),
});
```

Presets: `smtpPreset` (corporate relay, Postfix, SES-over-SMTP), `mailpitPreset` (local dev, `localhost:1025`), `logPreset` (tests/unconfigured), `httpPreset` (Resend/Postmark-style JSON endpoint). See [Notifications](/guides/notifications/).

## Install notes

`smtpPreset` needs the optional `nodemailer` peer:

```sh
nub add nodemailer
```

Log and HTTP presets work without it.

## Subpaths

Each preset is importable on its own (root aggregates all):

```ts
import { smtpPreset, smtpPresetFromEnv } from "@storyshelf/notify-email/smtp";
import { mailpitPreset } from "@storyshelf/notify-email/mailpit";
import { logPreset } from "@storyshelf/notify-email/log";
import { httpPreset } from "@storyshelf/notify-email/http";
import { createEmailNotifier } from "@storyshelf/notify-email/email";
```
