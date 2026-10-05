---
title: Auth overview
description: Choose how your StoryShelf instance authenticates users — local accounts, social login, OIDC, SAML, or passkeys.
---

StoryShelf ships one auth engine — [`@storyshelf/auth`](/packages/auth/) on [Better Auth](https://www.better-auth.com/docs). The login page renders one widget per configured method (`password`, `oauth`, `sso`, `passkey` descriptors). See also [Auth concepts](/concepts/auth/).

## Choose a method

| Type | When to use | Guide |
|------|-------------|-------|
| **Local accounts** | No IdP; invite-only email/password | [Local accounts](/guides/auth/local/) |
| **Social login** | GitHub / GitLab / Google / Microsoft / Cognito | [Social login](/guides/auth/social/) |
| **OIDC** | Keycloak, Okta, Auth0, Entra, Google Workforce | [OIDC](/guides/auth/oidc/) |
| **SAML** | Enterprise SAML IdP (via samlify, never hand-rolled XML) | [SAML](/guides/auth/saml/) |
| **Passkeys** | WebAuthn passwordless (second factor / primary) | [Passkeys](/guides/auth/passkeys/) |
| **None** | Trusted network / VPN / local dev | Below |

Configuration, secrets, and login text are covered in [Configuration](/guides/auth/configuration/).

## None (default)

With no auth configured, the web UI is open and project roles are not enforced. Fine for local dev (`npx storyshelf server init` → `Which auth? None`) or a VPN-protected demo.

:::caution
Do not expose an auth-less instance to the public internet — anyone can review, approve, or reject builds.
:::

## Secrets

`SECRET` signs session cookies — generate once, keep stable:

```bash
SECRET=$(openssl rand -hex 32)   # ≥ 32 characters, required at boot
```

Never reuse `SECRET` for `STORYSHELF_ADMIN_TOKEN` (site-admin bearer for project creation / purge).

## First admin bootstrap

With auth enabled and an empty DB, set `STORYSHELF_ADMIN_TOKEN` (or `ADMIN_TOKEN`) — its bearer grants site-admin API access without a session. Creating a project as a logged-in user also records you as that project's admin.

## Project roles, tokens, and public Storybooks

- **Roles:** `viewer` / `developer` / `approver` / `admin` per project plus site `admin`/`member` — see [Roles & tokens](/concepts/roles/).
- **API tokens:** CLI uses per-project `Authorization: Bearer <token>` (`STORYSHELF_TOKEN`) and site-admin tokens — not user login. See [Roles](/concepts/roles/) and guides above.
- **Public Storybooks:** viewable without auth when `public_branch_regex` matches or `build.public` is set — see [Publishing](/concepts/publishing/).
