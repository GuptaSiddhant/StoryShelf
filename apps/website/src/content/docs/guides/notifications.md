---
title: Notifications
description: Human-facing project and admin alerts over email and chat (Slack, Teams) — channels, subscriptions, and site-wide system events.
---

StoryShelf sends formatted notifications for build review events and site-wide admin alerts. Webhooks stay the machine primitive (signed JSON for custom receivers); notifications are the human primitive (server-formatted email and chat messages).

## Concepts

- **Channels** (project admin): where messages go — a Slack workflow webhook, a Teams workflow URL, or an email address — plus an event filter and display toggles. A channel with no project is site-wide and receives `sys:*` admin alerts only.
- **Subscriptions** (you): per-project opt-in. No row means silence. v1 delivers over email to `users.email`; Slack DMs are deferred.
- **Topics**: project events reuse webhook names (`build:created`, `build:reviewing`, `build:approved`, `build:rejected`, `baseline:created`, `baseline:updated`, `comment:created`); admin events are `sys:user-created`, `sys:invite-issued`, `sys:auth-failed`, `sys:capture-failed`, `sys:purge-completed`.

## Configure channels (project admin)

In **Settings → Notifications** or via API:

```sh
curl -X POST $SHELF/api/v1/projects/my-app/notification-channels \
  -H "Authorization: Bearer $STORYSHELF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "provider": "slack-webhook", "events": ["build:reviewing"], "config": { "style": "compact" }, "secret": "https://hooks.slack.com/..." }'
```

- `provider` — `slack-webhook` | `teams-workflow` | `email` (must be wired in `ShelfOptions.notifiers`; unknown kinds are a 400).
- `events` — allowlist or empty for all; `enabled` toggles delivery without deleting.
- Secrets (webhook URLs, SMTP passwords) are stored AES-256-GCM encrypted with server `SECRET` and decrypted only in memory at send time.
- Display toggles: `style` (`compact`|`verbose`), `subjectPrefix`, `includeAuthor`, `includeMessage`, `includeCounts`. Brand (name, logo, links) comes from server `UIConfig` + `publicBaseUrl`.

## Manage your subscriptions

- **Global**: `/profile#notifications` — one row per membership: email on/off plus topic checkboxes.
- **In context**: project **Settings → Notifications → My notifications for this project** edits the same row. Removing the row (or `enabled: false`) opts out.

User preferences require auth; with auth disabled only admin channels operate.

## Site-wide admin alerts

Site admins manage project-less channels (`POST /api/v1/admin/notification-channels`) subscribed to `sys:*`. Delivery is inline best-effort (`Promise.allSettled`, failures logged, never blocks captures or requests).

## Email transport

One SMTP configuration serves notification channels and (optionally) auth mail: wire the same sender into `createShelfAuth({ emailSender })` and `notifiers`. Without it, invites stay out-of-band links (fictional addresses keep working; sends are best-effort and the token is still returned). Presets: `smtp` (default), `mailpit` (local dev), `log` (tests/unconfigured), HTTP APIs (`resend`-style via shared `httpJson`).

## Related

- [Webhooks](/guides/webhooks/) — signed machine events for custom receivers
- [Project settings](/guides/project-settings/) — where channels are managed
- [REST API](/guides/api/) — endpoint walkthrough
