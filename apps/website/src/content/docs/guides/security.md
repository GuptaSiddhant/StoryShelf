---
title: Security and data handling
description: What StoryShelf stores, where your data goes, how credentials are protected, and how to harden and report on an instance.
---

StoryShelf is self-hosted, so your data stays where you put it. This page is the short version of what a security review usually asks: what is stored, who can see it, how secrets are protected, what the server connects to, and what you should set before sharing an instance. It links to the pages that go into detail.

:::caution
**Authentication is off by default.** A server scaffolded with no auth leaves the web UI open and project roles unenforced. That is fine on your laptop or a private network; before you share an instance, turn on [authentication](/guides/auth/) and set a strong `SECRET` (see [Hardening checklist](#hardening-checklist)).
:::

## What is stored

| What                                                                                 | Where                                           |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Projects, builds, snapshots, comments, review verdicts, users, memberships, settings | Your **database** (SQLite, Postgres or MySQL)   |
| Screenshots, diff overlays, and the uploaded Storybook builds                        | Your **storage** (local disk, S3, Azure or GCS) |
| Credentials for webhooks, git providers, chat channels and design providers          | The database, **encrypted** (see below)         |
| API tokens and invite links                                                          | The database, **hashed**                        |

A published Storybook is whatever you uploaded: its HTML, scripts and assets, as built. Screenshots show your components rendered with the data your stories contain, so treat the storage like the repository the Storybook came from. How long builds, screenshots and baselines are kept is set by [Retention & purge](/concepts/retention/).

## Who can see it

- **Roles.** Site roles (`admin`, `member`) and per-project roles (`viewer`, `developer`, `approver`, `admin`) decide who can view, upload, approve or administer. See [Roles & tokens](/concepts/roles/).
- **Public builds.** A build is viewable without signing in only if it is marked public or its branch matches the project's `public_branch_regex` (for example `^main$`). Every other build needs at least `viewer` membership. See [Published Storybook](/concepts/publishing/#public-vs-auth-gate).
- **API tokens.** Tokens are per project, shown once when created, stored hashed, and bound to the user who created them: demoting that user downgrades their tokens at once, and a token whose owner was deleted stops working.

## How credentials are protected

- **`SECRET`.** The server secret signs login sessions and CSRF tokens, and is the key for AES-256-GCM encryption of the credentials StoryShelf must read back: webhook signing secrets, notification-channel secrets (chat webhook URLs, git tokens, GitHub App private keys), and design-provider credentials. Set it to at least 32 random characters. Rotate it on purpose with the old value kept as a decrypt-only fallback: see [Rotating the server secret](/guides/deployment/secret-rotation/).
- **Never echoed back.** Stored secrets are not returned by the API or shown again in the UI, and are removed from log lines and error text.
- **Accounts.** Local accounts are invite-only. Invite links are single-use, expire after seven days and are stored hashed; passwords are at least 12 characters; there are no temporary passwords; login failures are generic so they do not reveal which emails exist. Single sign-on (OIDC and SAML), social login and passkeys are available through [Better Auth](https://www.better-auth.com/docs). See [Local accounts](/guides/auth/local/).
- **Webhooks you send** are signed with HMAC so receivers can verify them. See [Webhooks](/guides/webhooks/).
- **Signed Storybook URLs.** The one place a private build can be read without a session is a short-lived, signed, read-only link used by remote browsers. It grants one build's static files and nothing else, is rate-limited, and expires. See [Remote browsers](/guides/remote-browsers/#signed-storybook-urls).

## Running uploaded Storybooks safely

An uploaded Storybook is code from your repository, and StoryShelf runs it in a browser to take screenshots and shows it to reviewers.

- **In the review UI**, a story preview loads only when someone clicks it, in a sandboxed frame with scripts allowed but without access to the app's cookies or storage.
- **Uploads are bounded.** Zips are limited by size, entry count and uncompressed size, and entries with absolute paths or `..` are refused. See [Published Storybook](/concepts/publishing/#limits).
- **Capture runs on your server**, in a browser the server launches. Treat the host as you would any machine that executes your own front-end code; give it only the access it needs.

## What the server connects to

StoryShelf makes outbound connections only for the integrations you configure:

- git providers (GitHub, GitLab) for commit statuses and comments
- chat (Slack, Teams), email (SMTP or an HTTP API) and the webhooks you add
- single-sign-on and OAuth providers
- the design provider (Figma), if enabled
- an AI provider, if you configure one: AI is off until a site admin picks a profile for a project, and only that provider receives data. See [Privacy and safety](/ai/privacy/)
- remote browsers or a Playwright farm, if you use them
- your own OpenTelemetry collector, if you set an endpoint: traces and metrics go there and nowhere else. See [Observability](/guides/observability/)

There is no analytics, telemetry or update check in the server. The web UI ships its own scripts, styles and fonts and loads nothing from a CDN; the only content it can show from elsewhere is a profile picture, when your sign-in provider supplies one.

## Hardening checklist

1. **Turn on authentication** for any instance more than one person reaches, and choose [how people sign in](/guides/auth/).
2. **Set `SECRET`** to 32 or more random characters (`openssl rand -hex 32`) and keep it in your secret store. Plan how you would [rotate it](/guides/deployment/secret-rotation/).
3. **Set `PUBLIC_BASE_URL`** (or confirm the address on **System**), so links and notifications point at the right host. See [Public origin](/guides/config/#public-origin).
4. **Serve it over HTTPS**, in front of the server (a load balancer or reverse proxy); the reference stacks include DNS and certificates.
5. **Keep tokens narrow.** A token has the role of the user who created it, so create the CI token from an account that is only a `developer` on that project, not a project or site admin. Keep `STORYSHELF_ADMIN_TOKEN` out of routine uploads.
6. **Limit who is a project `admin` or `approver`**, and who can reach the storage bucket and the database directly.
7. **Pick what is public on purpose.** Leave `public_branch_regex` empty unless you want a branch's Storybook open to everyone.
8. **Back up** the database and the storage together, or use [baseline export](/guides/portability/) for the baselines.
9. **Stay current.** StoryShelf is pre-1.0 and security fixes go into the latest release only, so upgrade before reporting an issue on an older version.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through [GitHub security advisories](https://github.com/GuptaSiddhant/StoryShelf/security/advisories/new) with the affected package and version, steps to reproduce, and the impact you expect. You will get an acknowledgement within five business days, an assessment and a plan in the private advisory, and a coordinated disclosure window of 90 days. The full policy, including what is in scope, is in [SECURITY.md](https://github.com/GuptaSiddhant/StoryShelf/blob/main/SECURITY.md).
