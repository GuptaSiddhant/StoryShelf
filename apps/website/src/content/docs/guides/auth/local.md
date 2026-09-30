---
title: Local accounts
description: Invite-only email/password accounts — no IdP required.
---

For teams without an identity provider, the engine manages per-user email/password accounts. Admins invite an address; the user opens a one-time link, sets a password, and is signed in.

```ts
import { createShelfAuth } from "@storyshelf/auth";

const shelf = createShelfAuth({
  db: database,
  secret: process.env.SECRET!,
  baseURL: process.env.PUBLIC_BASE_URL!,
});

const app = createShelfApp({ database, storage, auth: shelf.adapter });

// Invite (admin): relay one URL out-of-band: /auth/invites/<inviteId>?token=<token>
const { inviteId, token } = await shelf.adapter.issueInvite({
  email: "ada@example.com",
  name: "Ada",
  role: "member",
});
```

- Invite links are **single-use**, expire after **7 days**, are stored hashed, and are superseded when re-issued — **re-invite is also the password-recovery flow**.
- There are **no temporary passwords**: nothing to shoulder-surf in the admin UI.
- Login failures are generic ("Invalid credentials") to avoid user enumeration.

:::note
Local emails are **identifiers, not mailboxes**. Deliverability is never checked, so fictional or future addresses (`front-desk@internal`) work — but self-service email reset can never reach them. Recovery is always admin re-invite.
:::

## Dev servers: env-driven admin

`apps/dev-server` and `apps/fly-app` provision a local admin from the environment on every boot:

```bash
AUTH_PASSWORD=a-long-admin-password   # at least 12 characters
AUTH_EMAIL=admin@local                # optional, defaults to admin@local
SECRET=$(openssl rand -hex 32)        # ≥ 32 characters
```

## Invite playbook

1. Admin (server or `POST` via `STORYSHELF_ADMIN_TOKEN`) calls `shelf.adapter.issueInvite({ email, name, role })`.
2. Copy the one-time URL `/auth/invites/<inviteId>?token=<token>` and relay it out-of-band (Slack, email, 1:1 — no SMTP in StoryShelf).
3. User opens the link, sets a password (≥ 12), and is auto-signed-in to `/profile`.
4. Expired or superseded links show “Invalid or expired invite”; generic “Invalid credentials” on login avoids enumeration. Re-invite to recover.

See [Configuration](/guides/auth/configuration/) for `resolveAuthOptions` and `SECRET` handling, and [Auth concepts](/concepts/auth/) for the engine vs shelf table split.
