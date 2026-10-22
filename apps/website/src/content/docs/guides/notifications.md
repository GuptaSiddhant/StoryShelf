---
title: Notifications
description: Human-facing project and admin alerts over email and chat (Slack, Teams), git statuses on GitHub and GitLab, channels, subscriptions, and site-wide system events.
---

StoryShelf sends formatted notifications for build review events and site-wide admin alerts. Webhooks stay the machine primitive (signed JSON for custom receivers); notifications are the human primitive (server-formatted email and chat messages).

## Concepts

- **Channels** (project admin): where messages go — a Slack workflow webhook, a Teams workflow URL, or an email address — plus an event filter and display toggles. A channel with no project is site-wide and receives `sys:*` admin alerts only. One settings page manages every channel, including git channels.
- **Delivery kinds**: a provider either sends a **message** once (Slack, Teams, email) or makes a git host show a **state** (GitHub, GitLab commit status and pull-request comment). Git channels follow the build, not a topic list, so they have no event filter and never receive chat messages. See [Git channels](#git-channels-commit-statuses).
- **Subscriptions** (you): per-project opt-in. No row means silence. v1 delivers over email to `users.email`; Slack DMs are deferred.
- **Topics**: project events reuse webhook names (`build:created`, `build:reviewing`, `build:approved`, `build:rejected`, `baseline:created`, `baseline:updated`, `comment:created`, plus `insight:ready` when an AI triage or health digest finishes); admin events are `sys:user-created`, `sys:invite-issued`, `sys:auth-failed`, `sys:capture-failed`, `sys:purge-completed`, `sys:notify-failed`, `sys:ai-budget`.

## Configure channels (project admin)

In **Settings → Notifications** or via API:

```sh
curl -X POST $SHELF/api/v1/projects/my-app/notification-channels \
  -H "Authorization: Bearer $STORYSHELF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "provider": "slack-webhook", "events": ["build:reviewing"], "config": { "style": "compact" }, "secret": "https://hooks.slack.com/..." }'
```

- `provider` — `slack-webhook` | `teams-workflow` | `email`, or a git provider (see below); it must be wired in `ShelfOptions.notifications.notifiers`, and unknown kinds are a 400.
- `events` — allowlist or empty for all; `enabled` toggles delivery without deleting.
- Secrets (webhook URLs, SMTP passwords) are stored AES-256-GCM encrypted with server `SECRET` and decrypted only in memory at send time.
- Display toggles: `style` (`compact`|`verbose`), `subjectPrefix`, `includeAuthor`, `includeMessage`, `includeCounts`. Brand (name, logo, links) comes from server `UIConfig` + `publicBaseUrl`.

## Git channels (commit statuses)

A git channel (`github`, `gitlab` from [`@storyshelf/notify-git`](/packages/notify-git/)) belongs to a project and shows the build's state on your repository: commit statuses named `<prefix>/testing` (or `<prefix>/review` without `testing`) and `<prefix>/storybook`, and one pull-request comment per build. It takes the repository as config and the token as its secret:

```sh
curl -X POST $SHELF/api/v1/projects/my-app/notification-channels \
  -H "Authorization: Bearer $STORYSHELF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "provider": "github", "config": { "owner": "acme", "repo": "widgets", "prefix": "storyshelf-web" }, "secret": "ghp_..." }'
```

A site-wide git channel, or one without a token, is a 400. On the settings page, use **Add a git channel**. To block merges until review is approved, see [Merge gate setup](/guides/merge-gate/).

Git delivery is **durable**, unlike messages: each state change is a `notify` job on the database queue that reads the build when it runs and is retried with backoff (five attempts), or delivered inline without durability on a host with no queue consumer. See [Delivery](/packages/notify-git/#delivery). Every channel (message or git) records its **last delivery error and time**: the settings page shows a failing channel with the error, and `GET …/notification-channels` returns `lastError` and `lastErrorAt` (both `null` while the channel delivers cleanly). The next successful delivery clears the error; a git delivery that is given up also raises `sys:notify-failed`.

## Manage your subscriptions

- **Global**: `/profile#notifications` — one row per membership: email on/off plus topic checkboxes.
- **In context**: project **Settings → Notifications → My notifications for this project** edits the same row. Removing the row (or `enabled: false`) opts out.

User preferences require auth; with auth disabled only admin channels operate.

## Site-wide admin alerts

Site admins manage project-less channels (`POST /api/v1/admin/notification-channels`) subscribed to `sys:*`. Message delivery is inline best-effort (`Promise.allSettled`, failures logged and recorded on the channel, never blocks captures or requests). `sys:notify-failed` is raised when a git channel's state delivery is given up after its retries; it names the channel, project, build and error.

## Email transport

One SMTP configuration serves notification channels and (optionally) auth mail: wire the same sender into `createShelfAuth({ emailSender })` and `notifications.notifiers`. Without it, invites stay out-of-band links (fictional addresses keep working; sends are best-effort and the token is still returned). Presets: `smtp` (default), `mailpit` (local dev), `log` (tests/unconfigured), HTTP APIs (`resend`-style via shared `httpJson`).

| Env                       | Purpose                             | Default  |
| ------------------------- | ----------------------------------- | -------- |
| `SMTP_HOST`               | SMTP relay host (unset = no sender) | —        |
| `SMTP_PORT`               | Relay port                          | `587`    |
| `SMTP_SECURE`             | `1`/`true` for implicit TLS (465)   | STARTTLS |
| `SMTP_USER` / `SMTP_PASS` | Relay credentials                   | —        |
| `SMTP_FROM`               | Sender address (`fromEmail`)        | —        |

Password recovery is both: users can request a reset email when a sender is configured; admins can always re-invite (which also resets access). Failed local logins emit `sys:auth-failed` to admin channels (SSO failures excluded in v1).

## Related

- [Webhooks](/guides/webhooks/) — signed machine events for custom receivers
- [Project settings](/guides/project-settings/) — where channels are managed
- [REST API](/guides/api/) — endpoint walkthrough
