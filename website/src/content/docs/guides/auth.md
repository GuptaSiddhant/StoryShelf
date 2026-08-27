---
title: Auth
description: Secure your StoryShelf instance with OIDC/OAuth, a shared password, or none for trusted networks.
---

Auth is a pluggable adapter. StoryShelf ships three modes: **none** (default, for trusted networks), **shared password** (for small teams), and **OIDC/OAuth** (for enterprises with an identity provider). You pick one when you configure the server.

## None (default)

With no auth configured, the web UI is open and project roles are not enforced. This is fine for:

- Local development (`storyshelf serve`).
- A demo or internal deployment behind a VPN.

:::caution
Do not expose an auth-less instance directly to the public internet — anyone can review, approve, or reject builds.
:::

## Shared password

A single shared password gates the UI. Configure it with an environment variable:

```bash
AUTH_PASSWORD=your-shared-password
```

Anyone with the password can log in as a full user. Good for a small team that wants a cheap login without standing up an identity provider.

## OIDC / OAuth

Plug into any OpenID Connect / OAuth2 provider — Keycloak, Authentik, Okta, GitHub, GitLab, Google. Configure via environment variables:

```bash
OIDC_ISSUER=https://keycloak.example.com/realms/myteam
OIDC_CLIENT_ID=storyshelf
OIDC_CLIENT_SECRET=your-client-secret
```

Users are created on first login (from the provider's identity) and assigned project roles.

## Project roles

Auth enables project-scoped roles, tracked per project via membership:

| Role | Capabilities |
|------|--------------|
| `viewer` | View builds, diffs, and published Storybooks |
| `developer` | View + upload builds |
| `approver` | View + approve/reject snapshots |
| `admin` | Full control, including members and settings |

Site-wide `admin` users (from the auth provider) bypass project roles entirely. For a public deployment, restrict access by granting roles through project settings.

## API tokens vs. user auth

Auth gates the **web UI**. The **CLI does not use user login** — it authenticates with **per-project API tokens** sent as `Authorization: Bearer <token>`. This keeps CI simple and lets a token be scoped to a single project. Tokens are minted by [`storyshelf init`](/guides/cli/) or in project settings.

## Public Storybooks

Published Storybooks can be made viewable **without auth** when their branch matches the project's `public_branch_regex` (e.g. `^main$` or `^release-`) or when a build is explicitly marked public. Every other Storybook requires auth and at least `viewer` membership. This lets you share component previews with stakeholders who don't have accounts.
