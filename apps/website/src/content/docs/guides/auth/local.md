---
title: Local accounts
description: Invite-only email/password accounts — no IdP required.
---

For teams without an identity provider, the engine manages per-user email/password accounts. Admins invite an address; the user opens a one-time link, sets a password, and is signed in.

```ts
import { createShelfAuth } from "@storyshelf/auth";

const shelf = createShelfAuth({
  db: database,
  secret: process.env.SHELF_SECRET!,
  baseURL: process.env.SHELF_PUBLIC_BASE_URL!,
});

const app = createShelfApp({ database, storage, auth: shelf.adapter });

// Invite (site admin): the UI and `storyshelf-server invite` call this for you, and the
// one-time link is /auth/invites/<inviteId>?token=<token>
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
SHELF_ADMIN_PASSWORD=a-long-admin-password   # at least 12 characters
SHELF_ADMIN_EMAIL=admin@example.com                # optional, defaults to admin@example.com
SHELF_SECRET=$(openssl rand -hex 32)        # ≥ 32 characters
```

## Invite playbook

1. A site admin creates the invite, in either of two ways:
   - **In the app:** open **System**, choose **Invite a user**, enter the email (and optionally a name and role). From a project's **Add member** dialog, an address with no account offers the same action.
   - **On the server:** run `storyshelf-server invite <email> [--name <name>] [--role member|viewer|admin]` in the instance project. It uses `SHELF_ADMIN_TOKEN` and prints the link once.
2. Copy the one-time link and relay it out-of-band (Slack, email, 1:1 — no SMTP in StoryShelf). It is shown once and never logged or stored apart from its hash in the invite record; lose it and invite again. The link is absolute when `SHELF_PUBLIC_BASE_URL` is set or an origin is confirmed; otherwise it is the path `/auth/invites/<inviteId>?token=<token>`, to put your server's address in front of.
3. User opens the link, sets a password (≥ 12), and is auto-signed-in to `/profile`.
4. Expired or superseded links show “Invalid or expired invite”; generic “Invalid credentials” on login avoids enumeration. Re-invite to recover.

See [Configuration](/guides/auth/configuration/) for `resolveAuthOptions` and `SHELF_SECRET` handling, and [Auth concepts](/concepts/auth/) for the engine vs shelf table split.
