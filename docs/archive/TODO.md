# BetterAuth engine — reviewer findings (for implementing agent)

Source: reviewer passes over `epic/auth-engine` (E2–E7 + E5 app mount, then re-review at `bf564fc2` after `32a16dac`/`8dcceea5`/`b0fc7cca`/`12545868` + refactors `e8f29bd2`/`73eef965`/`2cc8d99d`).
Reviewer did not modify code; all items need owner confirmation.

## Critical — fix before merge to main (original pass; now verified fixed — keep as regression guard)

1. **Open public signup bypasses invite-only model**
   - `packages/auth/src/engine.ts:444` now `disableSignUp:true`; `app.all("/api/auth/*",engine.handler)` direct `POST /api/auth/sign-up/email` → 400. Invite is sole email+password vector.
   - Guard: add test that direct signup without invite fails.
2. **Disabled users keep valid sessions**
   - `engine.ts:485` `if(stored?.disabled) return null` + `deleteUserSessions` (`engine.ts:531`) + `cookieCache:false` (`engine.ts:452`) → immediate revoke per request.
   - Caveat (see P1 below): raw `db.update(users,{disabled:true})` without `setDisabled` leaves engine rows until next `check()`.
3. **Invite double-accept TOCTOU**
   - `invites.ts:58` `withInviteTx` wraps `issueInvite:270`/`acceptInvite:314` in `transact`; `inviteSpent:302` downgrades busy. Still racy without driver txn (see P2 #5).

## High (original pass — mostly fixed, residuals noted)

4. **OAuth/email identity split-brain** — `invites.ts:189` now gates on `emailVerified===true` + `lower(email)` (`invites.ts:108`). Decide linking policy documented; unverified error leaks existence (acceptable for UX).
5. **`destroySession` token-format mismatch** — fixed via `deleteSessionByToken` (`engine.ts:515`, `sessions.ts:39`) handling signed `token.signature` → raw; dual `signOut` best-effort.
6. **Raw `/api/auth/*` mount bypasses shelf guards** — `index.tsx:113-127` now rate-limits `auth:` 100/min + `engine:` 300/min isolated buckets; origin check via Better Auth. Remaining CSRF gaps (see P2 #3).

## Medium (original pass)

7. Secret strength — `engine.ts:555` `length<32` at `setup()`; late vs schema (see P3 #8).
8. Stale profiles — `engine.ts:491` drift refresh keeps `displayNameOverride`; fixed.
9. Session tokens in profile HTML (`profile.ts:202`) — mitigated `no-store` (`profile.ts:148`) but still raw tokens (see P3 #7).
10. Logout clear-cookie `Secure` mirroring — fixed (`routers/auth.ts:316`).
11. `asEngineAuth` guard missing `issueInvite` — deleted with `2cc8d99d` collapse; `Auth` is now concrete.

## Low / hygiene (original pass)

- Email case normalization → fixed via `lower(email)`.
- Passkey RP-ID/origin (`engine.ts:92`) — still defaults to `baseURL` host/origin, breaks behind reverse proxy.
- `db-where.ts` LIKE unescaped → fixed `escapeLike` + `ESCAPE '\'`; new regression case-insensitive pattern (see P2 #4).
- `in` non-array → fixed `TypeError` (`db-where.ts:97`).
- Legacy invite `!==` non-constant-time — removed with `app/src/routers/auth.ts` legacy router.
- Expired sessions filtered client-side (`sessions.ts:56` only `expiresAt`) — dead rows until next `check()`/`deleteUserSessions`.

---

# Re-review at `bf564fc2` — remaining holes after fixes

## P1 — fix immediately

1. **CSRF token global, not per-session** — `packages/app/src/middleware/csrf.ts:41` `sessionIdFrom` returns `"default"` (header `session-id` never set). Token `sha256(secret:default:ts)` valid 24h for any user. Any `GET` token works for any victim.
   - Fix: bind to `SESSION_COOKIE` (`core/auth.ts:90` `storyshelf_session`); parse raw `Cookie` header before `storeScope` (raw cookie parse, not ALS).

2. **Rate-limit bypass via `X-Forwarded-For` spoof** — `packages/app/src/index.tsx:118,126` uses whole header verbatim. Attacker `X-Forwarded-For: <random>` per request rotates keys; header-less clients share `"auth:anonymous"` bucket (DoS).
   - Fix: `c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "anonymous"` + trusted proxy flag; ideally `getConnInfo` behind proxy.

## P2 — fix with P1 batch

3. **Auth CSRF gaps** — `packages/app/src/index.tsx:129` only wraps `/projects/:slug/settings/*`, `/profile/*`. Unwrapped: `POST /auth/logout` (`routers/auth.ts:311`), `POST /auth/invites/:inviteId` (`auth.ts:309`), `POST /api/auth/*` (passkey `verify-registration`/`verify-authentication`, `change-password`, `revoke-session`). Invite token is high-entropy but still should be wrapped; passkey requires user gesture but inconsistent.

4. **`LIKE` case-insensitive regression** — `packages/auth/src/db-where.ts:91` `patternValue(operator, String(item.value))` ignores lower-cased `raw`; `lower(col) LIKE '%Foo%'` mismatches `foo`. Breaks Better Auth `mode:"insensitive"` + `contains` email lookups.
   - Fix: `patternValue(operator, String(raw ?? ""))`.

5. **Invite TOCTOU without `transact`** — `packages/auth/src/invites.ts:65` fallback `return fn(db)` has zero isolation. Non-transacting adapter (fake DB) still races `Promise.all([accept(),accept()])` both pass `loadInvite:122`. Only SQLite `busy` path protected.
   - Fix: add `UPDATE … WHERE usedAt IS NULL` guard check `affected===0` → invite error, or document `transact` as required.

## P3 — cleanup / E11 follow-up

6. **Legacy login dead code** — `packages/app/src/pages/login.tsx:150,174` `accountEnabled`→`/auth/account/login` and `passwordEnabled`→`/auth/login` branches remain, routes unmounted after `2cc8d99d` → 404 if rendered. Remove; violates single-engine claim.

7. **Raw session tokens in HTML** — `packages/app/src/pages/profile.tsx:202` `<input hidden token>` + `routers/profile.ts:102` returns raw tokens. `no-store` mitigates but XSS/extension exfiltrates.
   - Fix: prefer `session.id` + server-side token resolve; engine `revoke-session` ideally takes `id`.

8. **Secret validation late** — `packages/auth/src/config.ts:104` `z.string().min(1)` vs `engine.ts:555` `length<32`. Error at `setup()` gate not config validation.
   - Fix: `min(32)` in `authOptionsSchema`.

9. **`sessions.ts:39` `split(".")[0]` + `deleteSessionByToken` list-then-remove** not atomic; concurrent revoke double-delete (harmless) but not transactional. Assumes single dot signing.

---

# Auth singleton refactor — confirmed plan (Option B: conditional import)

Decision: `auth` is not an adapter. All customization via Better Auth plugins/presets.
No external `AuthAdapter` consumers — clean break. Package `@storyshelf/auth-betterauth` → `@storyshelf/auth`
(singleton signal like `core`/`app`/`observability`). Fold into E11 breaking release. UI stays in `app` via lazy import.

## S1 — Rename `auth-betterauth` → `auth`

- FS `packages/auth-betterauth/` → `packages/auth/`; `package.json:2` `name:"@storyshelf/auth"`, `repository.directory:"packages/auth"`, `deno.json:3` same. (Done `e8f29bd2`.)
- Import sweep `→ "@storyshelf/auth"`: `apps/dev-server/src/server.ts:3`, `apps/fly-app/server.ts:3`, `apps/fly-app/rolldown.config.ts:29`, `packages/cli/src/commands/server/init.ts:122,200,204,206,208`, `packages/app/package.json:66`, `packages/runner-playwright/package.json:62`, `packages/app/src/routers/auth-engine.test.ts:1`, `packages/runner-playwright/src/passkey.integration.test.ts:10`, `docs/epic-auth-engine.md:13,47,95`, `docs/architecture.md` + this file.
- `nub ci` regen `nub.lock`; `nub run build`; verify `nubx tsc --noEmit`.

## S2 — Slim core slot (delete adapter abstraction)

- Keep `AuthUser` + `SESSION_COOKIE` — move from `packages/core/src/adapters/auth.ts:57` to `packages/core/src/auth.ts` (not `adapters/`). (Done `73eef965`.)
- Delete `packages/core/src/adapters/auth.ts` remainder (`AuthAdapter`, `PasswordLoginAuth`/`SsoLoginAuth`, `MultiAuth*`, `isMultiAuth`/`has*Login`) and `packages/core/src/adapters/multi-auth.ts:240` + `multi-auth.test.ts`; remove `core/package.json` export `./adapter/multi-auth` + `deno.json` entry; remove `AdapterCategory "auth"` (`core/src/adapters/metadata.ts:17`).
- `core/src/config.ts:229` `auth?: AuthAdapter` → `auth?: import("@storyshelf/auth").Auth`; `core/src/adapters/setup.ts:22` + `setup-runner.ts:54` remove `auth` from `AdapterSetupSources`/`pushHook`/`bindAdapterLoggers` (call `auth.setup?.()` directly).
- `packages/auth/src/engine.ts:104,338` `ShelfEngineAdapter extends AuthAdapter` → standalone `Auth` (no `metadata`/`lifecycle`/`Adapter` inheritance). `EngineAuth` duck-type (`app/src/routers/auth-engine.ts:46,75`) deleted; `app` imports `Auth` from `@storyshelf/auth`.

## S3 — Collapse app routing (single engine path)

- Delete `packages/app/src/routers/auth.ts:489` (legacy capability-probed router). (Done `2cc8d99d`.)
- `packages/app/src/routers/auth-engine.ts` → `packages/app/src/routers/auth.ts` with signature `registerEngineAuth(app: ShelfRouter, auth: Auth)`.
- `packages/app/src/index.tsx:29,147` `registerAuthFlow` collapses to `if (!options.auth) return; registerEngineAuth(app, options.auth); registerWellKnown(app, options.auth); registerProfile(app, options.auth)`; delete `asEngineAuth` branch + `import { registerAuth }`.
- `routers/well-known.ts:14,21` enumerate `auth.loginMethods()`; `routers/profile.ts:181,208` single engine path (drop legacy `handlePasswordChange:310`/`isLocalAccount:89` scrypt branch, keep `handleEnginePasswordChange:353`); fix TODO #11.
- `middleware/auth-gate.ts:8` + `store-scope.ts:22` → `resolveRequestUser(c, auth: Auth)` → `auth.check(c.req.raw)`.

## S4 — Bloat mitigation: conditional import (Option B)

- Do **not** move `pages/login.tsx:207`/`invite.tsx:70`/`profile.tsx:393`/`passkey-ceremony.ts:93` into `@storyshelf/auth` (would drag `hono`/`hono/jsx`/`hono/css` + `app/src/ui/*` facade + `getStore()` ALS + `UserModel`/`auth-sync` + `hxRedirect`/`csrf` into adapter, violating ADR 0001/0018 and `AGENTS.md` single-owner `hono`).
- Mitigate via lazy imports:
  ```ts
  async function registerAuthFlow(app, auth) {
    if (!auth) return;
    const { registerEngineAuth } = await import("./routers/auth-engine.ts");
    const { registerWellKnown } = await import("./routers/well-known.ts");
    registerEngineAuth(app, auth);
    registerWellKnown(app, auth);
  }
  // dynamic import renderLoginPage/renderInvitePage inside handlers;
  // split profile engine-only sections (Sessions/Passkeys) behind dynamic imports
  ```
- Ensure `authEnabled=false` mounts 0 auth routes (currently `registerProfile:181` still mounts 6 routes); 2,227-line surface (`763` UI + `1464` routing) not loaded.

## S5 — TODO criticals (same E11 gate)

- `disableSignUp` on engine (`engine.ts:444`), `disabled` check in `check` (`engine.ts:485`), `transact?` around invite accept (`invites.ts:58`). Tests: direct signup rejected, disabled session rejected, concurrent invite — one wins.

Each step a squash commit on `epic/auth-engine`; all fold into one E11 squash to `main`.
Verify per step: `nub run lint`, `nubx tsc --noEmit -p tsconfig.json`, `nub run test`, `nub run build`, `nub run fmt`; full `nubx turbo verify --force`.

---

# How presets/plugins evolve UI

## Presets (no UI code) — `packages/auth/src/presets/`

- Native social: `githubPreset`, `gitlabPreset`, `googlePreset`, `entraPreset` (`id:"microsoft"`), `cognitoPreset` → `ShelfSocialProvider` for `createAuth({ social })`.
- Enterprise OIDC: `keycloakPreset` (discovery), `oktaPreset`, `auth0Preset` → `ShelfOAuthProvider` for `createAuth({ oauth })` via `genericOAuth`.
- SSO (E9): `sso.ts:40` `samlAuthority`/`ssoCallbackUrls` for Better Auth SSO plugin.

Each preset returns config only; adding one adds one `EngineLoginMethod {kind:"oauth", id, label}` to `engine.ts:252` `describeLoginMethods` → one button in login, no profile change.

**Built-ins:** `emailPassword` (default true, invite-only via `issueInvite`), `passkeys` (`@better-auth/passkey` → `passkey({rpID,rpName,origin})`), `plugins` (escape hatch).

## Login page — `pages/login.tsx:82` + `routers/auth.ts:146`

- `GET /auth/login` (`routers/auth.ts:344`): if sole method `kind==="oauth"` → `302 /auth/engine/:id`; else `renderLoginPage({ engineMethods: loginLinks(methods) })` with `passwordEnabled:false` to suppress legacy forms.
- `renderLoginPage` branches on `engineMethods`:
  - `kind==="password"` → `<form POST /auth/engine/login>` (`login.tsx:100`)
  - `kind==="oauth"` → `<Button href="/auth/engine/:id">Sign in with {label}</Button>` per entry (`login.tsx:124`), templated `UIConfig.auth.ssoLabelTemplate`
  - `kind==="passkey"` → JS button `data-passkey-login` + `passkeyLoginScript()` (`login.tsx:135`)
  - Legacy `ssoProviders`/`accountEnabled`/`passwordEnabled` branches (`login.tsx:150,174,197`) are dead on engine path — to be removed (P3 #6).

## Profile page — `pages/profile.tsx:255` + `routers/profile.ts:111`

- `loadEngineSecurity:111` `Promise.all([listSessions, listPasskeys, hasPassword])`; current device via `SESSION_COOKIE` `split(".")[0]` (`profile.ts:98`).
- Renders: header (avatar/role/via/provider/groups) → display name → `isLocal`=`hasPassword` → change password → `SessionsSection` (devices + revoke + revoke-others) → `PasskeysSection` (`passkeysEnabled` + nudge + register `passkeyRegisterScript()`) → memberships → sign out. Enabling `passkeys:{}` flips the two profile sections.

**New `kind`/plugin:** requires extending `EngineLoginMethod.kind` + `describeLoginMethods` + `loginLinks` + `renderLoginPage` branch (and for profile, new `security.*` field + section). E8 passkey sign-in, E9 SAML POST callbacks, E10 plugin contract `UI descriptor kinds` cover this.

---

# Client interaction & HonoX assessment

**Today — minimal, page-local, no state:**

- Login: plain forms (`login.tsx:101` `POST /auth/engine/login`, `GET /auth/engine/:id` → 302 IdP). No JS.
- Passkey: two vanilla IIFEs inlined `dangerouslySetInnerHTML` — `passkey-ceremony.ts:24` register (`fetch generate-register-options` → `navigator.credentials.create` → `verify-registration` → `reload()`) and `:61` login (`generate-authenticate-options` → `get` → `verify-authentication` → `href='/'`), ~25 lines each, `PublicKeyCredential && isSecureContext` guard.
- Profile sessions/passkeys/password: plain POST forms → `forwardToEngine` + full re-render.

Global JS is vendored `htmx.js` + `themeScript()` + review diff script — none auth-specific.

**HonoX (file-based routing + islands + hydration) not warranted:** auth has zero islands, zero client state, every branch is `if(hasPassword)` server-rendered. Cost: second JSX runtime, vite hydration manifest, breaks `AGENTS.md` facade + `hono/css` single `<style id="storyshelf-css">` + `consistency.test.ts` ratchet. Keep `hono/jsx` server + HTMX + two vanilla IIFEs; only re-evaluate if a plugin adds stateful widget (e.g., TOTP QR).

---

# Client interaction required for auth (summary)

- Email/password: 0 JS (form POST).
- OAuth/OIDC/SAML: 0 JS (redirect to `engine.handler` → IdP → callback).
- Passkey register/login: small JS (WebAuthn `navigator.credentials` + 2 `fetch` calls); feature-detected, HTTPS/localhost only.
- Sessions/revoke, password change, invite accept: 0 JS (form POST + server `forwardToEngine`).
