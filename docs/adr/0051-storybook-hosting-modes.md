# ADR 0051: Storybook Hosting Modes and Access Contract

## Status

Accepted (owner, 2026-11-11; proposed by the architect and revised after the same day's security
review). It settles the contract that #356 asks for, under epic #355. Implementation is tracked in
#357 (modes 1 to 4, previews, caching), #358 (subdomain, mode 5), #359 (private paths and the request
contract of decision 9), #360 (custom domains, out of scope here) and #361 (docs). Until those land,
the behaviour described in Context is the only one that ships.

## Context

Published Storybooks are served from the app origin, at `/projects/:slug/storybook/build/:id/*`,
`/_/:id/*` (short link) and `/_s/<token>/*` (signed URL, ADR 0007 decision 5). Uploaded script runs
there with the viewer's session cookie. That risk is accepted in the ADR 0010 amendment (#916), which
also rejects a stopgap header. Sandboxing needs a different origin, and an opaque origin sends no
cookies. #916 measured on Storybook 8.6, 9 and 10 in Chromium: public builds load under a sandbox when
they answer `Access-Control-Allow-Origin: *`, and a private build does not load with the viewer's
cookie.

Facts checked against the code on 2026-11-11, which the decisions rely on:

- **Nothing routes by host.** No code in `packages/app` reads the request `Host`. `publishedBaseDomain`
  only changes link builders (`packages/core/src/urls.ts`, `storybook` and `storybookBuild`, used at
  about twenty call sites). A link to such a host works only behind a proxy the operator runs.
- **One key, and an unchecked purpose.** `packages/core/src/utils/storybook-token.ts` signs with one
  key, derived from `config.secret` under `storyshelf/storybook-url/v1`. The parser keeps a purpose only
  when it is `capture`, and a token with no purpose is accepted by `/_s/`. `preview-base.ts` mints such
  tokens for private preview frames.
- **The signed route is rate-limited.** `mountGuards` in `packages/app/src/index.tsx` limits `/_s/*` to
  6000 requests a minute per IP, before the token is read.
- **Build ids are upper-case ULIDs** (`packages/core/src/utils/ulid.ts`), and the short-link check
  (`isBuildId`) accepts only that case.
- **A manifest can be rewritten.** The manifest route (`packages/app/src/routers/builds.ts`) has no
  check. #356's comment of 2026-11-02 accepted this for now.
- **Session answers were publicly cacheable.** The project path and the ULID short link sent
  `public, max-age=31536000, immutable` to a signed-in viewer. #923 is the fix: #924 makes them
  `private`, and decision 10 moves them to `no-cache` with an ETag.
- **The session cookie** is `storyshelf_session`, or `__Secure-storyshelf_session` over https
  (`packages/core/src/types.ts:29-35`).

## Decision

### 1. Configuration and boot

```ts
storybookHosting: { mode: "trusted" | "sandboxed" | "subdomain"; baseDomain?: string }
```

- An unset value means `trusted`, which keeps today's behaviour.
- The server does not start when:
  - `mode` is missing or unknown, or the object has keys other than `mode` and `baseDomain`;
  - `publishedBaseDomain` and `storybookHosting` are both set (decision 6);
  - `sandboxed` or `subdomain` runs with sign-in on and no `secret`, because grants need the key;
  - `subdomain` runs without a configured portal origin;
  - `baseDomain` is missing for `subdomain`, or present for another mode.
- Validation lower-cases `baseDomain`, drops one trailing dot, and refuses a port, a scheme, a wildcard
  and any label that is not a valid DNS label. It also refuses a `baseDomain` that the portal host
  would match as a content label, which is the case when the portal host is exactly one label under
  `baseDomain` (portal `a.example.com`, `baseDomain` `example.com`). A portal host equal to
  `baseDomain` is allowed (decision 5).
- A configured value that does not validate never falls back to `trusted`.

### 2. `trusted`: path hosting on the app origin

This is today's behaviour, and the default. Its trust assumption: every person who can upload is
trusted with the session of every viewer of every Storybook. The risk is accepted in the ADR 0010
amendment (#916); this ADR does not restate it. The addon, offline Storybooks and the badges work only
in this mode (decision 11).

### 3. `sandboxed`: path hosting on a sandboxed origin

- Every uploaded file is answered with `Content-Security-Policy: sandbox allow-scripts allow-popups
allow-forms`. The header never includes `allow-same-origin`, `allow-top-navigation` or
  `allow-popups-to-escape-sandbox`. It covers every route family that serves uploaded files.
- The app's wrapper page (`/`, `pages/storybook.tsx`) is not uploaded content and keeps the app's
  headers.
- **Public builds** keep their paths and `Access-Control-Allow-Origin: *`, which #916 measured as
  working on 8.6, 9 and 10.
- **Private builds.** In `sandboxed` mode session access never serves uploaded bytes directly. The
  project path and the short link (`/_/:id/*`, by build id or by slug) check `publishedAccess`, then
  redirect with `302` to `/_r/<token>/<rest>` (decision 4). A viewer without access gets the same
  answer as for a missing build.

### 4. Read grants: `/_r/` and the `read` purpose

This widens what a token grants. The AGENTS.md invariant "Do not add routes under `/_s/` or widen what
a token grants" must be amended before #357 lands, to allow exactly this grant and nothing more.

- `/_r/<token>/*` is one route with class `hosting`, so it works without `testing`. It serves one
  build's files, never a page or an API. It is refused on content hosts (decision 5).
- Purpose `read` is minted only by the redirect of decision 3, by the preview frames of decision 8, and
  by the exchange of decision 5. It is signed with a key derived separately from the capture key.
  `/_s/` accepts only `capture` (decision 8).
- Lifetime: one hour. Renewal is a fresh redirect through the canonical path, which checks permission
  again, so revocation and logout take effect at renewal.
- Every answer is `Cache-Control: private, no-store`, with `Referrer-Policy: no-referrer` and
  `X-Robots-Tag: noindex`. A private build's answer carries no CORP header here (see amendment
  2026-11-11, CORP; decision 9 covers content hosts). Refusals are one identical 404, as on `/_s/`.
- `redactSecrets` (`packages/core/src/utils/redact.ts`) learns the `/_r/` prefix, as it already does for
  `/_s/`. The token is never logged.
- `/_r/*` shares the signed route's per-IP rate-limit bucket (decision 10).
- Read grants verify with the current secret only, never with `previousSecret`, so a rotation ends every
  read grant at once. Capture grants keep the ADR 0007 rule.
- **Why a URL token needs no viewer binding.** A leaked grant opens only the uploader's own build:
  `publishedAccess` requires both the project and the build id to match, so one build's grant cannot
  open another build. The residual leaks are proxy access logs, copied links and browser history. The
  lifetime bounds them. In mode 3 the token stays in the URL, because an opaque origin sends no cookie.

### 5. `subdomain`: one content host per build

- A build is served at `<build-id>.<baseDomain>`. The host label is the lower-case form of the stored
  upper-case ULID, and the lookup is case-insensitive. The label is one DNS label, so one wildcard
  certificate covers every build.
- The alias host `<project-slug>.<baseDomain>` never resolves a slug itself. It redirects every path to
  the portal's `/projects/<slug>/storybook`, so #497's not-found rule applies there.
- Refused as project slugs, and as the label of a content host: a 26-character ULID shape (already
  refused for the short link), and the reserved labels `www`, `api`, `app`, `admin`, `auth` and `static`.
- **Content hosts send no sandbox header.** An earlier draft required one. It is withdrawn: under a
  sandbox a content page is opaque and sends no cookie (#916), so the exchange below could never work.
  The isolation is the separate origin plus the cookie exchange, the request rules of decision 9, and
  the `Cross-Origin-Resource-Policy` on private answers.
- A content host serves only its own build's files and answers only that build. Every portal and API path
  answers 404. A content host never serves `/_r/` paths.
- **Private builds** follow the owner's decision of 2026-11-08. The portal checks permission and redirects
  with `302` to `https://<build-id>.<baseDomain>/_x/<exchange-token>/<rest>`. `/_x/` is the exchange path:
  it exists on content hosts only, and it is distinct from `/_r/`.
  The exchange token has purpose `exchange`, lives 60 seconds, and is accepted only by the exchange route
  on its matching host. The exchange answers navigations only (decision 9). The content host checks that
  the token's build equals its own, then sets a host-only cookie: no `Domain`, `Secure`, `HttpOnly`,
  `SameSite=Lax`, and `Max-Age` of one hour. It then redirects to the clean URL. Renewal, revocation and
  rotation work as in decision 4.
- The cookie is named `__Host-storyshelf-grant`, because the prefix forces `Secure`, `Path=/` and no
  `Domain`. Its value is a sealed value that names the build and the expiry, and the content host checks it
  against its own build on every request. The value is never the exchange token.

### 6. `publishedBaseDomain` is retired

Today the setting only changes links, to the two-level shape `https://<build-id>.<slug>.<domain>`. One
wildcard certificate (`*.<domain>`) cannot cover that shape, and no host routes it. The setting becomes an
alias for `{ mode: "subdomain", baseDomain }`, logs a deprecation warning for one minor release, and is
then removed. The two-level link shape is dropped. Setting it together with `storybookHosting` stops boot
(decision 1). Operators whose proxy routes those hosts move to the one-label form.

### 7. Published builds are write-once

- `POST /api/v1/projects/:slug/builds/:buildId/manifest` compares the manifest with the one already
  accepted. An identical manifest answers `200` as a no-op: it does not call `complete` or `enqueueCapture`.
  A different manifest answers `409`.
- Acceptance is an atomic claim in the database. A build counts as accepted only when its publish verdict
  is ok, so a failed publish can be retried with a new manifest.
- The rule binds the API route, not the internal publish-job writer.
- The CLI does not treat a `409` as success. A repeated identical manifest is a `200`.

### 8. Previews and `/_s/`

- Previews of private builds, by mode:
  - `trusted` and `sandboxed`: the preview frame loads `/_r/`, so it works without `testing`.
    `preview-base.ts` mints a `read` token for it.
  - `subdomain`: the portal must not serve uploaded bytes, and a content host never serves `/_r/`. A frame
    is opaque under the sandbox below, and an opaque frame sends no cookie, so the exchange cannot work in
    a frame. A private preview therefore opens the content host in a new tab, which the click-to-load preview
    already offers. Public previews load in a frame of the content host.
- Every preview frame keeps `sandbox="allow-scripts"` without `allow-same-origin`, in every mode.
- `/_s/` becomes capture-only: a token with no purpose, or any other purpose, is refused. The earlier
  claim that `/_s/` accepts only `capture` was wrong, because no-purpose tokens are served there today.
- Preview tokens minted before the change are refused after deploy. They are short-lived, so the effect is
  an open preview frame that must reload.

### 9. Cookies and cross-site requests

- **Portal session cookie in `subdomain` mode.** The portal's session cookie must carry the `__Host-`
  prefix. The current names are `storyshelf_session` and `__Secure-storyshelf_session`
  (`types.ts:29-35`). The prefix stops a content host, which is a subdomain of the portal host, from setting
  or overwriting the portal's cookie through `Domain=`. Changing the mode renames the cookie, so everyone is
  signed out once. `trusted` and `sandboxed` keep their names.
- **Cookie name and mechanism.** The `__Host-` name is a requirement. The mechanism is the auth engine's cookie
  configuration, not a constant: the library adds the `__Secure-` prefix today. That mechanism is confirmed in #358.
- **Navigations only for the grant hops.** The portal redirect and the content host's exchange answer only
  navigations: `Sec-Fetch-Mode: navigate`, with `Sec-Fetch-Dest` of `document` or `iframe`. Any other request
  gets the identical 404.
- **Private answers from a content host carry `Cross-Origin-Resource-Policy: same-origin`.** Attack this
  blocks: build A is uploaded, so its page is attacker-controlled. A is a different host from B but the same
  site. A `Lax` cookie is sent on same-site requests, so A's page could include B's private script with B's
  host-only cookie attached, and then read that script in A's origin. CORP stops a cross-origin, same-site
  embed of B's private files.
- **CSRF contract.** Every state-changing request that carries a session cookie is refused unless `Origin`
  equals the portal origin, or `Sec-Fetch-Site` is `same-origin` or `none`. This covers `/api/v1`, because
  `CSRF_PATHS` in `index.tsx` covers page routes only. Verifying it is part of #359 (#786).

### 10. Caching and rate limits

- Public answers keep `public, max-age=31536000, immutable` for hashed files, and slug short links keep
  `max-age=60` and `max-age=3600`.
- Session answers and content-host answers for private builds are `private, no-cache`, with the content hash
  as `ETag`, so revocation and logout reach cached copies. PR #924 shipped `private, max-age=31536000,
immutable` as an interim fix. #357 moves it to `no-cache` with an ETag, answered `304` on a match.
- Signed answers keep `private, no-store`, or the capture cache rule (ADR 0007).
- `/_r/*` shares the signed route's per-IP bucket. Its limit moves out of `testing.storybookUrlRateLimit`
  into a top-level setting (name fixed in #357), and the old option stays as an alias.

### 11. Features by mode

| Feature                              | `trusted`                                 | `sandboxed`                                 | `subdomain`                                                                             |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Addon (ADR 0042)                     | Badges on the app origin                  | Inert: no panel, no request, no CORS (#916) | No badges (#530)                                                                        |
| Offline Storybooks (ADR 0048)        | Yes                                       | No: the API and opt-in UI say so            | No: same reason                                                                         |
| Component preview embeds (ADR 0010)  | Click-to-load frame; previews use `/_r/`  | Click-to-load frame; previews use `/_r/`    | Public: click-to-load frame of the content host. Private: a new tab on the content host |
| Capture, local and remote (ADR 0007) | Unchanged: `/_s/` capture grants          | Unchanged                                   | Unchanged                                                                               |
| Screenshot review                    | Unchanged: review pages on the app origin | Unchanged                                   | Unchanged                                                                               |

Capture keeps `/_s/` capture grants in every mode. Review pages never move to another origin.

### 12. Route and security matrix

Credentials and CORS:

| Route family                                         | Class     | Credential                                                                    | CORS                                                      |
| ---------------------------------------------------- | --------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| Project path `/projects/:slug/storybook/build/:id/*` | `hosting` | Session (`trusted`; `sandboxed` redirects private builds), or none for public | `*` for public builds only                                |
| Short link `/_/:id/*`                                | `hosting` | As the project path                                                           | As the project path                                       |
| Signed URL `/_s/<token>/*`                           | `testing` | `capture` token only                                                          | `*` for a capture grant                                   |
| Read grant `/_r/<token>/*`                           | `hosting` | `read` token, one build, one hour                                             | `*`, never `Allow-Credentials`: the URL is the credential |
| Exchange `/_x/<token>/*` on a content host           | `hosting` | `exchange` token, 60 s, navigations only                                      | None                                                      |
| Content host files `<build-id>.<baseDomain>/*`       | `hosting` | Host-only grant cookie, or none for public                                    | `*` for public builds only                                |
| Alias host `<slug>.<baseDomain>/*`                   | `hosting` | None                                                                          | None: redirects to the portal                             |

Headers, with the target values:

| Route family                                      | `Cache-Control`                                                                  | Sandbox CSP      | Other                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------- |
| Project path and short link, public               | `public, max-age=31536000, immutable` (slug: `max-age=60` / `3600`)              | `sandboxed` only | `Referrer-Policy` none                                    |
| Project path and short link, session, `trusted`   | `private, no-cache`, ETag (#924 interim: `private, max-age=31536000, immutable`) | None             | None                                                      |
| Project path and short link, session, `sandboxed` | None: a `302` to `/_r/`, `private, no-store`, `no-referrer`                      | None             | As the redirect                                           |
| `/_s/<token>/*`                                   | `private, no-store`, or the capture cache rule                                   | Not set          | `no-referrer`, `noindex`                                  |
| `/_r/<token>/*`                                   | `private, no-store`                                                              | Always           | `no-referrer`, `noindex`, No CORP (see amendment 2026-11-11, CORP) |
| Exchange and portal redirect                      | `private, no-store` on the `302`                                                 | None             | `no-referrer`, navigations only                           |
| Content host, public                              | `public, max-age=31536000, immutable`                                            | None             | None                                                      |
| Content host, private                             | `private, no-cache`, ETag                                                        | None             | CORP `same-origin`                                        |

Every route family that serves a build passes through `publishedAccess`, and CORS comes only from
`publishedCorsHeaders`. A request whose `Host` is neither the portal, a content host nor an alias host
answers 404.

### 13. Consequences for the tasks

- **#357** (modes 1 to 4): config and boot refusals, the `sandboxed` headers, `/_r/` and the `read` purpose
  and key, `/_s/` capture-only, previews on `/_r/`, `redactSecrets`, the caching and ETag change, the
  rate-limit setting, the AGENTS.md amendment, route classification, OpenAPI, and tests for each refusal.
  The write-once manifest rule is part of this task too.
- **#358** (mode 5): the content-host router, the host lookup, the reserved and ULID label checks, the alias
  redirect, the exchange route at `/_x/`, the host-only cookie, the `__Host-` portal cookie, and the
  build-equality check.
- **#359**: the request contract of decision 9 (navigations, CORP, CSRF on `/api/v1`, #786), and what a viewer
  sees when a one-hour grant expires in an open frame.
- **#360**: custom domains, out of scope here.
- **#361**: documentation of the three modes, the migration from `publishedBaseDomain`, single-host setup,
  operator-managed DNS and TLS, and the difference between same-site and same-origin.

## Consequences

- Operators choose one mode explicitly. A mode they never set keeps today's behaviour.
- Changing to `subdomain` signs everyone out once, because the portal cookie is renamed.
- The one-hour read grant is the price of working without third-party cookies. A viewer whose grant expires
  in an open page loses sub-resources until the frame reloads through the canonical path.
- Revocation and logout reach an open private page at the next renewal, up to one hour later.
- Write-once builds change the upload API's repeated-request behaviour, though not its accepted content.

## Alternatives considered

- **A cookie-only sandbox.** Rejected: an opaque origin sends no cookie, and #916 measured private builds
  failing under the sandbox.
- **A sandbox header on content hosts.** Rejected for the same reason: it stops the cookie exchange that
  isolates private builds.
- **A portal cookie with `Domain=`.** Refused: the cookie would reach every content host under the domain.
- **A header-only stopgap on the app origin.** Rejected in the ADR 0010 amendment (#916).

## Amendment, 2026-11-11 (CORP, #357)

- `Cross-Origin-Resource-Policy: same-origin` applies to private answers from **content hosts** only
  (decision 9), never to `/_r/`.
- Measured in #357: a sandboxed page has an opaque origin, which is cross-origin to the app origin, so
  CORP blocks its own no-CORS sub-resources (images, fonts, `<link>` stylesheets). The cross-build attack
  CORP closes needs a same-site cookie, which exists only on content hosts.
- The #357 browser test that asserts a `/_r/` image loads is the guard for this rule.
- Confirmed in #357: the preview-token refresh route is class `hosting`, and the option is named
  `storybookUrlRateLimit`, with `testing.storybookUrlRateLimit` as an alias.
