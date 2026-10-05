---
title: Rotating the server secret
description: Change SECRET without losing stored webhook, git and notification credentials.
---

`SECRET` encrypts three kinds of stored credentials (AES-256-GCM): webhook signing secrets, git-provider tokens, and notification-channel secrets. Changing it without a plan leaves those rows unreadable, so StoryShelf keeps the old value as a **decrypt-only fallback** while you migrate.

## Procedure

1. Set the new value and keep the old one:

   ```sh
   SECRET=<new value>
   SECRET_PREVIOUS=<old value>
   ```

   The scaffolded `server.ts`, `dev-server` and `fly-app` read both. In code this is `ShelfConfig.secret` and `ShelfConfig.previousSecret` (a single value, not a list).

2. Restart. The server decrypts with `SECRET` first and falls back to `SECRET_PREVIOUS`, so webhooks, git statuses and notifications keep working.

3. Re-encrypt the stored credentials under the new secret, in either way:
   - **Automatically at boot:** also set `SECRET_MIGRATE=true` (`ShelfConfig.migrateCredentialsOnBoot`). It is off by default.
   - **From the UI:** a site admin opens **System** and presses **Re-encrypt with current secret**. This is available whether or not auto-migration is on. The same action is `POST /api/v1/admin/credentials/reencrypt`.

4. Check the **Stored credentials** card on the System page: every credential should be under the current secret and none unreadable. Then remove `SECRET_PREVIOUS` (and `SECRET_MIGRATE`).

## When something is wrong

A credential that neither secret can decrypt is never silent:

- The server logs an error at boot with the table and row id (never the value).
- The System page shows the **Unreadable** count with an alert.
- `POST /api/v1/health` reports a failed `credentials` entry, so the overall status is `degraded`.
- Git status posts for an undecryptable token are skipped, with a logged error that points at `SECRET` / `SECRET_PREVIOUS`.

Fix it by setting `SECRET_PREVIOUS` to the secret that row was encrypted with, or recreate the webhook, token or channel.

## Sessions

`SECRET` also signs login sessions and CSRF tokens. Rotating it signs everyone out once; sessions are not carried over by `SECRET_PREVIOUS`.
