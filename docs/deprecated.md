# Deprecated Packages

Running log of removed/renamed packages. Each entry records the replacement
and the `npm deprecate` status per published version. Retiring a package =
append a row here in the same PR that deletes it, then run the
`npm deprecate` commands iteratively (requires npm auth; cannot run in CI)
and flip the status cell to ✅ with the date.

Resolve `<version>` lists at run time via `npm view <pkg> versions`
(oldest → newest):

```sh
npm deprecate <pkg>@"<version>" "Deprecated: use <replacement> instead. See docs/deprecated.md."
```

| Package | Deprecated since | Replacement | `npm deprecate` status |
|---|---|---|---|
| `@storyshelf/db-turso` | `0.6.0` (merged into `@storyshelf/db-sqlite/turso`) | `import { createTursoDatabase } from "@storyshelf/db-sqlite/turso"` + peer `@libsql/client` | ⏳ pending |
| `@storyshelf/auth-password` | `0.5.2` (`d771e895` wholesale Better Auth engine) | `@storyshelf/auth` — local accounts via the engine + invite flow (`issueInvite`/`acceptInvite`); **password hashes are incompatible → re-invite users** | ⏳ pending |
| `@storyshelf/auth-oauth` | `0.5.2` (`d771e895` wholesale Better Auth engine) | `@storyshelf/auth` presets (`keycloakPreset`, `cognitoPreset`, github/gitlab/google/entra/okta/auth0, SAML); existing issuer URLs keep working | ⏳ pending |

## `@storyshelf/db-turso` → `@storyshelf/db-sqlite/turso`

- **Why:** Turso is a libSQL transport over the same SQLite-dialect schema,
  DDL, and Drizzle factory already owned by `db-sqlite`; a separate package
  only duplicated the dependency graph. All SQLite presets (`turso`,
  `better-sqlite3`, `bun-sqlite`, `d1`) now live as `@storyshelf/db-sqlite/*`
  subpaths with optional peers.
- **Migration:** replace the `@storyshelf/db-turso` dependency with
  `@storyshelf/db-sqlite` plus the `@libsql/client` peer, and change the
  import to `@storyshelf/db-sqlite/turso`. `createTursoDatabase` keeps its
  `{ url, authToken }` signature and additionally accepts `syncUrl`,
  `syncInterval`, or an injected `client` (caller-owned lifecycle).

## `@storyshelf/auth-password` → `@storyshelf/auth`

- **Why:** wholesale Better Auth engine (`d771e895`); local accounts are now
  a recipe over the shared engine instead of a bespoke adapter.
- **Migration:** follow `docs/migration-auth-engine.md`. Local password
  hashes are incompatible — re-invite users. `AUTH_PASSWORD` is now the
  local-admin bootstrap secret (≥12 chars), not a shared login.

## `@storyshelf/auth-oauth` → `@storyshelf/auth`

- **Why:** wholesale Better Auth engine (`d771e895`); OAuth/OIDC is now a
  preset over the shared engine instead of a bespoke adapter.
- **Migration:** follow `docs/migration-auth-engine.md`. Existing issuer
  URLs keep working via the engine presets.
