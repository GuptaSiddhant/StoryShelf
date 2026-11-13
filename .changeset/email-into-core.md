---
"@storyshelf/core": minor
"@storyshelf/notify-email": minor
---

Breaking: the email integration moved into core; SMTP presets are async and need the optional nodemailer peer

The email presets (`smtpPreset`, `smtpPresetFromEnv`, `mailpitPreset`, `httpPreset`, `logPreset`) and `createEmailNotifier` now live in `@storyshelf/core/integrations` (ADR 0049), and core registers a built-in `email` notifier that stays inactive until a transport is configured. `nodemailer` is an optional peer of core, loaded only when an SMTP transport is built; a missing peer fails there with `SMTP needs the nodemailer package: install nodemailer@^10.2.1`. `smtpPreset`, `smtpPresetFromEnv` and `mailpitPreset` now return a promise: `await` them. `@storyshelf/notify-email` is deprecated and only re-exports core for one minor release.
