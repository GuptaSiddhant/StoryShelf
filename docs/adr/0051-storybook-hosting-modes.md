# ADR 0051: Storybook Hosting Modes and Access Contract

## Status

Proposed (architect, 2026-11-11), for the owner to accept. It settles the contract that #356 asks
for, under epic #355. Implementation is tracked in #357 (modes 1 to 4), #358 (subdomain, mode 5),
#359 (private paths of modes 4 and 5), #360 (custom domains, out of scope here) and #361 (docs).
Until it is accepted, the current behaviour in the Context section is the only one that ships.

## Context

Published Storybooks are served from the app's own origin, at `/projects/:slug/storybook/build/:id/*`,
`/_/:id/*` (short link) and `/_s/<token>/*` (signed URL, ADR 0007 decision 5). Uploaded script runs
there with the viewer's session cookie. The risk of that is accepted in the ADR 0010 amendment of
2026-11-11 (#916), which also rejects a stopgap header: a sandbox header breaks private builds and
protects nothing on public ones. Sandboxing needs a different origin, and the one a sandbox gets
(opaque) sends no cookies. #916 measured this on Storybook 8.6, 9 and 10 in Chromium: public builds
load under a sandbox when they answer `Access-Control-Allow-Origin: *`; a private build does not
load with the viewer's cookie.

Facts checked against the code on 2026-11-11, which the decisions below rely on:

- **Nothing routes by host.** No code in `packages/app` reads the request `Host`. `publishedBaseDomain`
  only changes link builders in `packages/core/src/urls.ts` (`storybook` and `storybookBuild`, which
  produce `https://<slug>.<domain>` and `https://<buildId>.<slug>.<domain>`), and about twenty call
  sites in the app use it. A link to such a host works only behind a proxy the operator runs.
- **The token.** `packages/core/src/utils/storybook-token.ts` signs with one key, derived from
  `config.secret` under the context `storyshelf/storybook-url/v1`. Its only purpose is `capture`, and
  the parser accepts no other. Lifetimes run from 60 s to 86 400 s.
- **The signed route is rate-limited.** `mountGuards` in `packages/app/src/index.tsx` puts a per-IP
  limit (6000 requests a minute by default) on `/_s/*` before the token is read.
- **Build ids are upper-case.** `packages/core/src/utils/ulid.ts` generates Crockford ULIDs in upper
  case, and the short-link check (`isBuildId`, `storybook.handlers.ts`) accepts only that case.
- **A manifest can be rewritten.** The manifest route (`packages/app/src/routers/builds.ts`) writes
  whatever it receives. It has no 409 today, which #356's comment of 2026-11-02 accepted for now.
- **Session answers are publicly cacheable.** Files of a signed-in viewer's private build are sent
  with `Cache-Control: public, max-age=31536000, immutable` on the project path and on the ULID short
  link (`storybook.handlers.ts`, the `IMMUTABLE` constant; `published-files.ts` sends the caller's
  `cacheControl` for every access except `token`). Tracked as #923; decision 9 gives the target.

## Decision

### 1. Configuration

```ts
storybookHosting?: { mode: "trusted" | "sandboxed" | "subdomain"; baseDomain?: string }
```

- An unset value means `trusted`, which keeps today's behaviour.
- `baseDomain` is required for `subdomain` and refused for the other modes.
- Boot validation lower-cases the value, drops one trailing dot, and refuses a port, a scheme, a
  wildcard, a label that is not a valid DNS label, a domain equal to the portal's host, and a parent
  of the portal's host (portal `a.example.com`, `baseDomain` `example.com`).
- A configured value that does not validate stops the server from starting. It never falls back to
  `trusted`.
- `publishedBaseDomain` is retired in decision 6.

### 2. `trusted`: path hosting on the app origin

This is today's behaviour, and it is the default for backward compatibility. Its trust assumption is
that every person who can upload is trusted with the session of every viewer of every Storybook. The
risk is accepted in the ADR 0010 amendment (#916); this ADR does not restate it. Mode 2 is the only
one where the addon, offline Storybooks and the badges work (see decision 8).

### 3. `sandboxed`: path hosting on a sandboxed origin

- Every uploaded file is answered with `Content-Security-Policy: sandbox allow-scripts allow-popups
allow-forms`. The header never includes `allow-same-origin`, `allow-top-navigation` or
  `allow-popups-to-escape-sandbox`. This covers every route family that serves published files: the
  project path, the short link `/_/:id/*`, and both token paths.
- The app's wrapper page (`/`, `pages/storybook.tsx`) is not uploaded content and keeps the app's
  headers.
- **Public builds** keep their paths and their `Access-Control-Allow-Origin: *`, which #916 measured
  as working on 8.6, 9 and 10.
- **Private builds.** A signed-in viewer who opens the canonical path passes `publishedAccess`, and
  is redirected with `302` to a read-grant URL, `/_r/<token>/<rest>` (decision 4). A viewer without
  access gets the same answer as for a missing build.

### 4. Read grants: `/_r/` and the `read` purpose

This widens what a token grants, which the AGENTS.md invariant "Do not add routes under `/_s/` or
widen what a token grants" does not allow. The invariant needs amending before #357 lands. The
amendment is part of the implementation, not of this ADR.

- A new prefix, `/_r/`, served by one route with class `hosting`, so it works without `testing`.
- A new purpose, `read`, for one build. It is minted only by the `publishedAccess` redirect in mode 3
  and by the exchange in mode 5, from `storybook-token.ts`, under a key derived separately from the
  capture key. `/_s/` keeps accepting only `capture`.
- Lifetime: one hour. Renewal is a fresh redirect through the canonical path, which checks permission
  again, so revocation and logout take effect at renewal.
- Every answer is `Cache-Control: private, no-store`, with `Referrer-Policy: no-referrer` and the
  `noindex` header. The token is never logged; logs use `redactSecrets`. `/_r/*` joins the existing
  `signed-storybook` rate-limit bucket in `mountGuards`. Refusals are one identical 404, as on `/_s/`.
- The token stays in the URL in mode 3. An opaque origin sends no cookie, so the URL is the only
  credential that can reach it. That is accepted and bounded by the lifetime.
- Read grants verify with the current secret only, never with `previousSecret`, so a rotation ends
  every read grant at once. They last at most one hour, so this is acceptable. Capture grants keep the
  ADR 0007 rule, which accepts `previousSecret` during rotation.
- The read token is single-use at the exchange in mode 5.

### 5. `subdomain`: one content host per build

- A build is served at `<build-id>.<baseDomain>`. The host label is the lower-case form of the build id,
  which is stored as an upper-case ULID (`ulid.ts`). The lookup is case-insensitive. The label is one
  DNS label, so one wildcard certificate covers every build.
- `<project-slug>.<baseDomain>` redirects to that project's published build (the latest approved
  build on the default branch, as the short link does).
- Refused as project slugs, and as the label of a content host: a 26-character ULID shape (already
  refused for the short link, which must tell a build id from a slug), and the reserved labels `www`,
  `api`, `app`, `admin`, `auth` and `static`.
- A content host serves only its own build's files. Every portal and API path answers 404.
- The portal is never on `baseDomain` or a subdomain of it.
- **Private builds** follow the owner's decision of 2026-11-08. The app checks permission and redirects
  to `https://<build-id>.<baseDomain>/_r/<token>/`. The content host exchanges the grant once for a
  host-only cookie: no `Domain`, `Secure`, `HttpOnly`, `SameSite=Lax`, and a `Max-Age` equal to the
  grant's lifetime. It then redirects to the clean URL. Renewal, revocation and rotation are as in
  decision 4. The cookie is named `__Host-storyshelf-grant`: the `__Host-` prefix forces `Secure`,
  `Path=/` and no `Domain`. Its value is the grant's opaque id or a sealed token, decided in #358. It is
  never the read token itself.
- The sandbox header is required in this mode too (decision 3's header, on every content answer). It
  is defence in depth. A content host under the portal's registrable domain is same-site with the
  portal, and `SameSite=Lax` cookies still flow on same-site requests, so the origin split alone is not
  enough. The docs recommend a `baseDomain` on a separate registrable domain, but do not require it, so
  a single-domain operator can still run this mode. CSRF protection against same-site requests is an
  acceptance item of #359 (#786).

### 6. `publishedBaseDomain` is retired

Today the setting only changes links, to the two-level shape `https://<build-id>.<slug>.<domain>`.
One wildcard certificate (`*.<domain>`) cannot cover that shape, and no host routes it. The setting
becomes an alias for `{ mode: "subdomain", baseDomain }`, logs a deprecation warning for one minor
release, and is then removed. The two-level link shape is dropped. Operators whose proxy routes those
hosts must move to the one-label form.

### 7. Published builds are write-once

Once a build's manifest is accepted, `POST /api/v1/projects/:slug/builds/:buildId/manifest` answers
`409`. Content hosts and CDNs can then cache a build's files as immutable. This changes the upload
API. A retried manifest request that matches the accepted one should be answered as success by the
CLI, and that is for #357.

### 8. Features by mode

| Feature                              | `trusted`                                 | `sandboxed`                                                        | `subdomain`                             |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| Addon (ADR 0042)                     | Badges on the app origin                  | Inert: no panel, no request, no CORS (#916 amendment)              | No badges (#530)                        |
| Offline Storybooks (ADR 0048)        | Yes                                       | No: the API and opt-in UI say so                                   | No: same reason                         |
| Component preview embeds (ADR 0010)  | Click-to-load frame of the path URL       | Click-to-load frame of the path URL; private builds through `/_r/` | Click-to-load frame of the content host |
| Capture, local and remote (ADR 0007) | Unchanged: `/_s/` capture grants          | Unchanged                                                          | Unchanged                               |
| Screenshot review                    | Unchanged: review pages on the app origin | Unchanged                                                          | Unchanged                               |

Capture keeps using `/_s/` capture grants in every mode. Review pages never move to another origin.

### 9. Route and security matrix

Credentials and CORS:

| Route family                                         | Class     | Credential                                                    | CORS                                                                     |
| ---------------------------------------------------- | --------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Project path `/projects/:slug/storybook/build/:id/*` | `hosting` | Session (`trusted`, `sandboxed` private) or none (public)     | `*` only for public builds, nothing for session (`publishedCorsHeaders`) |
| Short link `/_/:id/*`                                | `hosting` | As the project path                                           | As the project path                                                      |
| Signed URL `/_s/<token>/*`                           | `testing` | `capture` token                                               | `*` for a capture grant                                                  |
| Read grant `/_r/<token>/*` (new)                     | `hosting` | `read` token, one build, one hour                             | None: same-origin only                                                   |
| Content host `<build-id>.<baseDomain>/*` (new)       | `hosting` | Host-only cookie from the exchange, or none for public builds | `*` for public builds, nothing for private                               |
| Project alias host `<slug>.<baseDomain>` (new)       | `hosting` | None                                                          | None: it only redirects                                                  |

Cache and headers. These are the targets by access. The current values for a signed-in viewer are
wrong for private files and are tracked as #923.

| Route family                                  | `Cache-Control` (target)                                                | Sandbox CSP                      | Other                    |
| --------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------- | ------------------------ |
| Project path and short link, `public` access  | `public, max-age=31536000, immutable` (as today)                        | Only in `sandboxed`              | `Referrer-Policy` none   |
| Project path and short link, `session` access | `private, max-age=31536000, immutable` (today `public`; #923)           | Only in `sandboxed` (via `/_r/`) | As above                 |
| Slug short link `/_/<slug>/*`, `public`       | `public, max-age=60` or `public, max-age=3600` (as today)               | Only in `sandboxed`              | As above                 |
| Slug short link `/_/<slug>/*`, `session`      | `private, max-age=60` or `private, max-age=3600` (today `public`; #923) | Only in `sandboxed`              | As above                 |
| `/_s/<token>/*`                               | `private, no-store`, or the capture cache rule (ADR 0007)               | Not set                          | `no-referrer`, `noindex` |
| `/_r/<token>/*` (new)                         | `private, no-store`                                                     | Always                           | `no-referrer`, `noindex` |
| Content host, public build                    | `public, max-age=31536000, immutable`                                   | Required (decision 5)            | `Referrer-Policy` set    |
| Content host, private build                   | `private, max-age=31536000, immutable`                                  | Required (decision 5)            | `Referrer-Policy` set    |

Every route family that serves a build passes through `publishedAccess`, and CORS comes only from
`publishedCorsHeaders`. A route that answers nothing for a token is refused with the same 404 as a
missing build.

### 10. Consequences for the tasks

- **#357** (modes 1 to 4): config and validation, the `sandboxed` headers, `/_r/` with its `read`
  purpose and key, the AGENTS.md amendment, the rate-limit bucket, the route classification, OpenAPI,
  and tests for each refusal.
- **#358** (mode 5): the content-host router, the host lookup, the reserved and ULID label checks, the
  alias redirect, the host-only cookie exchange, and the cookie's name and format.
- **#359**: the private paths of modes 4 and 5, including what a viewer sees when a one-hour grant
  expires in an open frame.
- **#360**: custom domains, out of scope here.
- **#361**: documentation of the three modes, the migration from `publishedBaseDomain`, single-host
  setup, operator-managed DNS and TLS, and the difference between same-site and same-origin.

## Consequences

- Operators choose one mode explicitly. A mode they never set keeps today's behaviour.
- The one-hour read grant is the price of working without third-party cookies. A viewer whose grant
  expires in an open page loses sub-resources until the frame reloads through the canonical path.
- Revocation and logout take up to one hour to reach an open private page in modes 3 and 5.
- Write-once builds change the upload API for the CLI's retry path.
- Private files of a signed-in viewer must stop being publicly cacheable before any mode ships. That
  fix is #923, and it is independent of this ADR's modes.

## Alternatives considered

- **A cookie-only sandbox.** Rejected: an opaque origin sends no cookie, and #916 measured private
  builds failing under the sandbox.
- **A portal cookie with `Domain=`.** Refused: the cookie would reach every content host under the
  domain, which is the leak the host-only cookie exists to prevent.
- **A header-only stopgap on the app origin.** Rejected in the ADR 0010 amendment (#916).
