# @storyshelf/notify-email

> **Deprecated.** The email integration is now part of `@storyshelf/core` (ADR 0049). This package re-exports it for one minor release and is then retired. Import from `@storyshelf/core/integrations` instead.
>
> `smtpPreset`, `smtpPresetFromEnv` and `mailpitPreset` are now **async** (they load the optional `nodemailer` peer of core): `await` them. Install `nodemailer@^10.2.1` yourself for SMTP.

Email notification transport for StoryShelf: one SMTP/HTTP transport serves notification channels and (optionally) auth mail. 

## Install

```sh
nub add @storyshelf/notify-email
```

## Quick start

```ts
import { createShelfApp } from "@storyshelf/app";
import { createShelfAuth } from "@storyshelf/auth";
import { createEmailNotifier, smtpPreset } from "@storyshelf/core/integrations";

const sender = await smtpPreset({ host: "mail.example.com", port: 587, from: "shelf@example.com" });
const app = createShelfApp({
  database,
  storage,
  notifications: { notifiers: [createEmailNotifier(sender, { from: "shelf@example.com" })] },
  // Optional: invites and password resets share the same transport.
  // auth: createShelfAuth({ db, secret, baseURL, emailSender: sender }),
});
```

## Presets

| Preset          | Use for                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `smtpPreset`    | A corporate relay or Postfix. `smtpPresetFromEnv` reads the settings from environment variables.                |
| `sesPreset`     | Amazon SES over SMTP (`email-smtp.<region>.amazonaws.com`, port 587, STARTTLS). `sesPresetFromEnv` reads the env. |

| `mailpitPreset` | Local development against Mailpit (`localhost:1025`).                                                            |
| `httpPreset`    | A Resend- or Postmark-style JSON HTTP endpoint.                                                                  |
| `logPreset`     | Tests and unconfigured setups — messages are written to the log.                                                 |

### Amazon SES

`sesPreset({ region, user, pass, from })` is SMTP configuration only: no AWS SDK, and it needs the same optional `nodemailer` peer as `smtpPreset`. `user` and `pass` are **SES SMTP credentials** (created in the SES console and derived from an IAM user; an IAM access key does not work). `sesPresetFromEnv` reads `SES_REGION` (or `AWS_REGION`), `SES_SMTP_USER`, `SES_SMTP_PASS` and `SES_FROM`, and returns `undefined` unless all four resolve.

Before it can send, SES needs a **verified sending identity** for `from` (an address or its domain) in that region. A new SES account is in the sandbox, which also limits recipients to verified identities until you request production access.

See [Notifications](https://storyshelf.js.org/guides/notifications/) for how email channels, subscriptions, and auth mail fit together.

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
