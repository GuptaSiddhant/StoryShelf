# Epic: Better Auth engine (baked in like Drizzle)

> Source of truth until `gh` auth is repaired, then mirror to GitHub
> milestone `auth-engine` (issues E1–E12 below map 1:1 to future issues).
> Branch: `epic/auth-engine` (from `main`; never commit epic work to `main`
> directly — squash-merge per task on completion).
> Spike evidence: `spike/better-auth-core` branch (`spike-better-auth-FINDINGS.md`,
> `packages/core/src/auth-spike/*.test.ts`, 6 tests green).

## Direction (locked)

- Core stays lean: only `transact?` is added to `DatabaseAdapter`. Everything
  else lives in a new `@storyshelf/auth` package (bridge + engine +
  presets), following the core-interfaces/packages-implement shape.
- Wholesale Better Auth sessions under our `storyshelf_session` cookie name,
  cookieCache off. Bridge alternative rejected (auto-created session rows).
- Side-by-side tables (`user/session/account/verification` + plugin tables)
  with shared ULID ids (`advanced.database.generateId` — NOT
  `advanced.generateId`, which silently falls back); our `users` table stays
  sovereign, mirrored via `databaseHooks`.
- Single adaptive login UI calling `auth.api.*` server-side; never
  `better-auth/client`. `auth-password`/`auth-oauth` reborn as preset recipes;
  shared-password tier **dropped**. Local passwords force-reset (hash formats
  incompatible on 3 axes). Exact pins (`1.7.6`, no caret).
- Drivers: sqlite-proxy needs ARRAY rows (already true) + Date→ISO
  normalization in the shared wrapper; strict schema checker stays enabled.

## Conventions (repo rules)

- One issue = one task branch (`task/<id>`) off `epic/auth-engine`, squash-merge
  back into the epic branch. File-disjoint per issue; check `Files to Modify`.
- Verify per issue: `nub run lint`, `nubx tsc --noEmit -p tsconfig.json`,
  `nub run test` (or `turbo verify --filter=...`), `nub run fmt`, `nub run build`.
- `nub.lock` is per-worktree — never install concurrently in one tree.

## Wave 0 — foundation (E1+E2+E3 parallel-safe; E3 needs E2's table defs)

### E1 — ✅ DONE (`170bd573`) `feat(auth-engine): optional transact on DatabaseAdapter`
Goal: atomic `consumeOne` everywhere; reusable primitive.
Work: add `transact?<R>(fn: (tx: TxStore) => Promise<R>): Promise<R>` where
`TxStore` = insert/update/get/remove/list/count subset; implement in
db-sqlite + db-turso (+pg factory if present); bridge falls back to sequential
when absent (documented). Contract tests incl. rollback proof per driver.
Files: `packages/core/src/db/*`, `packages/db-*/src/*`.
Verify: per-package lint/tsc/test/build.

### E2 — ✅ DONE `feat(auth-engine): @storyshelf/auth scaffold + opaque bridge`
Goal: Better Auth `DBAdapter` over core `DatabaseAdapter`, dialect-blind.
Work: new package; model→table/field registry for auth tables;
`Where[]`→drizzle conditions (eq/ne/gt/gte/lt/lte/in/like, AND/OR), sortBy,
limit/offset; `select` post-filter; `supportsDates: false`; `transaction`
via `transact?` else sequential (documented). Unit tests vs fake DB.
Files: `packages/auth/*` (new).
Verify: new package lint/tsc/test/build green; no other package touched.

### E3 — ✅ DONE `feat(auth-engine): auth tables DDL in driver pipelines`
Goal: base tables exist on both drivers via existing migration story.
Work: drizzle table defs in the new package; vendor base
`user/session/account/verification` DDL into db-sqlite `ddl.ts` (+turso shared
path); `ensureColumns` coverage; empty-DB + pre-existing-DB migration tests.
Files: `packages/auth/src/schema/*`, `packages/db-sqlite/src/ddl.ts`.
Verify: db-sqlite + db-turso suites; strict checker passes against the tables.

## Wave 1 — engine + UI (E4→E5 sequential; E6 after E4)

### E4 — ✅ DONE `feat(auth-engine): createShelfAuth engine + AuthAdapter wrapper`
Goal: working engine behind our interface.
Work: factory (curated plugins, ULID ids, our cookie name, cookieCache off,
`databaseHooks` mirror into `users`, session TTL parity); wrapper `check`
(getSession on raw headers) + `destroySession` (signOut) + role join from our
`users`; composite interop kept. Commit spike WS1/WS3 scenarios as real tests.
Files: `packages/auth/src/*`.
Verify: package suite incl. sqlite-proxy + libsql round-trips.

### E5 — `feat(auth-engine): descriptor-driven single login UI`
Goal: one login page adapts to configured methods, server-rendered.
Work: mount `/api/auth/*` (documented Hono pattern); method descriptors →
form/buttons/passkey-JS; `auth.api.*` in routes; Keycloak redirect test
(spike WS4 scenario committed); null-session → anonymous via existing gate.
Files: `packages/app/src/*`.
Verify: app suite green (incl. new router tests).

### E6 — ✅ DONE `feat(auth-engine): password + OIDC presets, drop shared tier`
Goal: old packages become recipes; breaking surface defined.
Work: `auth-password` → email/pass config + invite front-end recipe (token
table stays, accept calls admin create/set-password); `auth-oauth` presets →
native socials (github/gitlab/google/entra/cognito) + genericOAuth recipes
(keycloak/okta/auth0); remove protocol code + shared tier; draft breaking notes.
Files: `packages/auth/src/presets/*`, `packages/auth-password/*`,
`packages/auth-oauth/*`.
Verify: affected suites; old packages' tests migrated or removed deliberately.

#### E6 breaking surface (draft for E11)
- Packages `@storyshelf/auth-password` and `@storyshelf/auth-oauth` are
  deleted. Consumers use `@storyshelf/auth` (`createShelfAuth`,
  presets, `issueInvite`/`acceptInvite`, `ensurePasswordAdmin`).
- Shared-password tier is gone (no `createPasswordAuth`, no viewer tier,
  no `AUTH_VIEWER_PASSWORD`). Dev/demo servers provision an env-driven
  admin via `ensurePasswordAdmin` (`AUTH_PASSWORD` ≥ 12 chars, `AUTH_EMAIL`
  overrides `admin@local`).
- Local password hashes are incompatible (scrypt → Better Auth): existing
  local users must be re-invited; OAuth users keep working (engine links by
  email on next sign-in).
- `storyshelf server init` scaffolds the engine: `password` → email/pass +
  `ensurePasswordAdmin` bootstrap; `oauth` on AWS → `cognitoPreset` social
  (new `COGNITO_DOMAIN` env); otherwise → `keycloakPreset` recipe on
  `OIDC_ISSUER`.
- `entraPreset` is now the native `microsoft` social (not generic OIDC);
  `cognitoPreset` is now the native `cognito` social (not generic OIDC).
- Invite accept auto-signs-in (POST accepts → engine sign-in → `/profile`).
- Mirror hook preserves existing shelf roles (invited admins stay admins).

## Wave 2 — methods + config modes (parallel after E4)

### E7 — ✅ DONE `feat(auth-engine): profile enrollment + session management`
Passkey register/revoke, password change, device list, revoke-all; `/profile`
wiring; "register a 2nd key" nudge. Files: `packages/app/src/*`,
`packages/auth/src/*`.

#### E7 breaking surface (draft for E11)
- New `passkey` table in driver DDL (auto-migrates via `IF NOT EXISTS`);
  `@better-auth/passkey@1.7.6` pinned next to `better-auth@1.7.6`.
- `/profile` on engine installs gains Devices (per-device revoke, sign out
  others), Passkeys (list, delete, register ceremony, <2-key nudge), and
  password change via `/change-password` (revokes other sessions).
- Social-only users see no password form (no credential account).
- Session cookies are signed (`token.signature`); current-device matching
  strips the signature before comparing with the table token.
- Legacy scrypt `profile-password.ts` path retained for non-engine adapters.
- Passkeys are on for dev/fly servers (`passkeys: {}`); CLI scaffolds leave
  them off until E10 config-as-code.

### E8 — ✅ DONE `feat(auth-engine): passkey plugin + ceremony JS`
Plugin enablement + vendored passkey-table DDL, page-local vanilla ceremony,
RP-ID derivation (host/`publicBaseUrl`), TLS/secure-context docs +
feature-detect hiding. Real-browser check rides the gated suite.
Files: as E7 + `packages/db-sqlite/src/ddl.ts`.

#### E8 breaking surface (draft for E11)
- Login page gains a descriptor-driven "Sign in with a passkey" button
  (rendered when `passkeys` is enabled); ceremony is page-local vanilla JS
  (`passkey-ceremony.ts`), no client framework.
- Passkey buttons feature-detect (`PublicKeyCredential` + secure context)
  and disable with a "needs HTTPS or localhost" note on plain-HTTP LAN/IP.
- `passkey.updated_at` is nullable: the plugin's registration create omits
  it (its model schema has no such field).
- Bridge `consumeOne`/`incrementOne` are tx-aware: atomic at the top level,
  direct on the ambient `tx` inside Better Auth transactions (fixes
  `cannot start a transaction within a transaction` on single-connection
  sqlite; covered by a bridge regression test + the gated browser flow).
- Gated `passkey.integration.test.ts` (CDP virtual authenticator) walks
  register → sign out → passkey sign-in end to end.

### E9 — ✅ DONE `feat(auth-engine): SAML/SSO plugin + POST callbacks`
Per-provider SSO recipes, callback-method routing (deferred SAML plan),
ACS metadata docs, samlify-via-plugin (never hand-rolled XML).
Files: `packages/app/src/routers/*`, `packages/auth/src/presets/*`.

#### E9 breaking surface (draft for E11)
- New `ssoProvider` table in driver DDL (auto-migrates via `IF NOT EXISTS`);
  `@better-auth/sso@1.7.6` pinned next to `better-auth@1.7.6`.
- `createShelfAuth({ sso: { providers } })` wires the SSO plugin with
  code-driven `defaultSSO` entries (precedence over DB rows): OIDC via IdP
  discovery, SAML via samlify. Recipes: `ssoKeycloak/ssoOkta/ssoAuth0` +
  `ssoGoogle/ssoEntra` (OIDC) and `samlPreset` (explicit fields or IdP
  metadata XML).
- SSO methods render as `sso`-kind login buttons; the app start route POSTs
  `/sign-in/sso` and 302s to the IdP. OIDC callbacks (GET) and SAML ACS
  (GET+POST, incl. form-encoded POST bodies) flow through the raw
  `/api/auth/*` mount untouched.
- Runtime provider management (`/sso/register`, update/delete, provider
  listing, domain verification) is blocked via `disabledPaths`: providers
  are code, not runtime DB rows.
- IdP configuration per provider via `ssoCallbackUrls(baseURL, id)`:
  ACS, SP metadata (`?providerId=`), and OIDC callback URLs.
- E6 genericOAuth recipes stay (simple IdP login); SSO is the domain-routed
  enterprise path with SP metadata + SAML. CLI scaffolding still emits the
  E6 recipes (revisited in E10 config-as-code).

### E10 — ✅ DONE `feat(auth-engine): config-as-code + custom-plugin contract`
Code>DB>defaults precedence; shared zod schemas; `{env}` refs +
`resolveSecrets` hook (Vault/AWS/GCP customer-owned); read-only UI badges;
brand packs in code; plugin contract (UI descriptor kinds, `{sqlite,pg}` DDL
fragments, reserved-route collision guard). Files: `packages/core/src/config.ts`,
`packages/auth/src/*`, `packages/app/src/*`.

#### E10 breaking surface (draft for E11)
- `resolveAuthOptions()` (new `config.ts`): validates engine options with
  shared zod schemas and resolves `{env:NAME}` secret refs from
  `process.env` first, then the customer-owned `resolveSecrets` hook.
  Precedence: explicit literal > `{env}` ref > schema default; code
  (`defaultSSO`, recipes) > DB rows > plugin defaults at sign-in.
- New `auth-tables-pg.ts` (pg-core mirrors) + auth tables in the Postgres
  DDL (`"user"`, `session`, `account`, `verification`, `passkey`,
  `"ssoProvider"`); pg parity test mirrors the sqlite one. Live pg
  round-trips stay deferred (no hermetic pg here).
- Plugin contract: `EngineLoginMethodKind` documents the descriptor kinds
  and login-URL convention; duplicate method ids throw at boot;
  custom plugins shadowing shelf-reserved engine paths throw at boot
  (built-ins are shelf-owned and exempt).
- Admin System page shows active login methods as read-only badges;
  `brandPacks` (`storyshelf`, `ocean`) in core validate against
  `uiConfigSchema`.

## Wave 3 — release

### E11 — ✅ DONE `docs(auth-engine): migration + breaking-change release`
Forced re-login comms, local-password resets, re-invites, dual-driver
migration verification, ADR update (containment→wholesale), guides +
preset/recipe docs, exact pins, JSR dry-run, remote-Turso check.
Files: `docs/**`, `apps/website/src/content/docs/**`.

#### E11 verification notes
- Migration guide: `docs/migration-auth-engine.md` (breaks, env changes,
  code migration, dual-driver checklist, exact pins).
- ADR 0023 records wholesale; ADR 0008 status points at it.
- Website: `guides/auth.md` rewritten for the engine, new
  `packages/auth.md` (old password/oauth pages deleted, sidebar
  updated), demo/deployment/cloud/roles pages patched; `astro build`
  green (56 pages).
- `docs/architecture.md` + `architecture-diagrams.md` point at the engine.
- JSR dry-run: slow-type errors on drizzle table exports are pre-existing
  (same class in `db-sqlite`) and accepted — release publishes with
  `--allow-slow-types`; no JSR token in this environment for a live check.
- Remote Turso: driver shares the sqlite DDL, so the six tables flow
  automatically; live remote verification is a manual release step.

### E12 — DEFERRED BY DEFAULT — `feat(auth-engine): TOTP ladder + custom role bundles`
Only on demand. Kept out of the epic.

## Resumability

- `git log --oneline epic/auth-engine` shows completed issues (one squash commit each).
- Open work = lowest uncompleted E-number above not on the branch.
- When `gh` works: `gh milestone create auth-engine`, then one `gh issue create`
  per E-item (title = heading, body = Goal/Work/Files/Verify), then close this
  file's role to the milestone (keep file as index or delete).

## Follow-ups (post-E11, on `epic/auth-engine`)

Reviewer findings (two passes) plus the approved singleton refactor, all
committed on this branch:

- `fix(auth-engine): close open signup, disabled sessions, invite atomicity`
  (public signup off, `disabled` check + `setDisabled` revocation, transacted
  invites, tests on the invite flow).
- `fix(auth-engine): verified-email linking for invite credentials`
  (link-if-verified else clean reject; case-insensitive lookup).
- `fix(auth-engine): reviewer hardening batch` (auth rate limits, 32-char
  secret, profile no-store, Secure clear-cookie, drift refresh, token-based
  `destroySession`) and LIKE-escaping follow-up.
- S1 `refactor: rename auth-betterauth to auth`; S2 `refactor: slim core
  slot, standalone Auth singleton` (`Auth` lives in `core/auth` — the
  prescribed core→auth edge cycles turbo, so the interface moved down and
  the engine implements + re-exports it); S3+S4 `refactor: collapse app
  routing to single engine path` (legacy router deleted, `asEngineAuth`
  gone, profile engine-only, auth routes gated when disabled; async lazy
  loading declined — needs async `createShelfApp`).
- `feat(auth-engine): IdP group sync for SSO providers` (per-recipe
  `groupsClaim`/`groupsAttribute`/`adminGroups`, full-reconcile site roles,
  `sso:` project grants, manual grants win; social/generic logins excluded).
- `fix(auth-engine): reviewer findings batch (verified)` (session-bound
  CSRF, peer-first rate-limit identity, CSRF on logout/invites, LIKE
  case-insensitivity, transact-required invites, dead login branches,
  id-based revoke, post-resolution secret floor, avatar allowlist).
