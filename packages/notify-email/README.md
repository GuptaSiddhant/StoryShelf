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
