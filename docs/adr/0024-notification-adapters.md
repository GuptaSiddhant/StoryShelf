# ADR 0024: Notification Adapters (Email + Chat)

## Status

Accepted

## Context

Outbound communication is webhooks-only (`webhooks` table, signed JSON POST per project in `core/adapters/webhook-events.ts`). That is a machine primitive: the consumer owns formatting. Operators asked for human primitives — formatted Slack/Teams messages and email — with project-level channels (admin-owned) and per-user opt-ins, plus site-wide admin alerts (new users, failures, purge). Prior discussion locked scope to email + chat (WhatsApp/push/SMS deferred), `users.email` identity, inline best-effort delivery, Brand + toggles formatting (no custom templates v1), and `notify-email` + `notify-chat` packaging.

## Decision

1. **New `notifier` adapter family.** `core/adapter/notifier/*`: `NotifierProvider` descriptor (`metadata { category: "notifier", kind, logo?, schema }` + `create()`, mirroring `GitHostProvider`) and `NotifierAdapter.send()`. `ShelfOptions.notifiers[]` lists implementations; unknown `kind` on channel create is a 400 (status-configs pattern).
2. **Two packages, split by identity and dependency weight.** `notify-email` owns `nodemailer` (`smtp`/`mailpit`/`log`/HTTP-API presets); `notify-chat` is zero-dep `fetch`-only (`slack-webhook`/`teams-workflow`/`log`, Mattermost/Discord later as renderers). WhatsApp stays separate later (phone identity + template approval).
3. **Storage: keep `webhooks`, add two tables.** `notification_channels (project_id NULL, provider, config JSON, secret_encrypted NULL, events NULL=all, enabled)` — `NULL` project means site-wide `sys:*` admin channel. `notification_subscriptions (project_id, user_id, events, via ["email"] v1, enabled, UNIQUE(project, user))`. No `webhooks` migration; convergence happens at the emitter.
4. **Shared plumbing.** `core/adapter/email-sender.ts` (`EmailSender`, consumed by fan-out and optionally `auth` for invites/resets); pure `format.ts` (brand from `UIConfig` + `publicBaseUrl` links + toggles; settings preview reuses it); `events.ts` (`emitNotifications` + `emitSystemNotification`, inline `Promise.allSettled`, non-fatal). All outbound sends go through `httpJson` (ADR 0019); `webhook-events.ts` raw `fetch` migrates to it.
5. **Event catalog.** Project topics reuse webhook names (`build:*`, `baseline:*`, `comment:created`); admin topics are `sys:user-created`, `sys:invite-issued`, `sys:auth-failed`, `sys:capture-failed`, `sys:purge-completed`. ADR 0026 adds the project topic `insight:ready` and the admin topic `sys:ai-budget`. Defaults: opt-in (no subscription row = silent).

## Consequences

- Machine (`webhooks`) and human (notifiers) payloads stay decoupled; one topic catalog serves both.
- `auth`-without-SMTP keeps working (out-of-band invite links); with `emailSender` wired, invites/resets share the notification transport and branding.
- Per-user Slack DMs, phone numbers, custom templates, and durable outbox/retries are explicit non-goals for v1.

## Auth mail addendum

- `ShelfAuthOptions` accepts `emailSender` (the same transport instance
  notification channels use — single `nodemailer` owner), `fromEmail`, a
  `logger`, and one `onAuthSystemEvent(event, data)` hook for
  `sys:user-created` / `sys:invite-issued`. The hook is best-effort
  (failures logged, never break auth) and fires from both the mirror hook
  (SSO/social first logins) and the invite-accept wrapper (direct
  credential writes bypass Better Auth's `databaseHooks`).
- Invites are best-effort email: the link sends when a sender is set, but
  the token is always still returned (fictional addresses keep working).
- Resets are both: `sendResetPassword` is wired when a sender is set (user
  self-service); re-invite stays available to admins regardless.
- `sys:auth-failed` fires on local-login credential failures only
  (`POST /auth/engine/login` 401s — never 429/5xx noise, never secrets;
  spray attempts can fan out, bounded by the `/auth/*` rate limit).
- Background emitters (in-process capture completion, scheduled purge)
  use explicit-deps variants (`notifySystemWith`) since no request scope
  exists there; remote-queue workers own their own alerting.
