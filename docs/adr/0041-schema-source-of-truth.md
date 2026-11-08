# ADR 0041: Single Source of Truth for the Database Schema

## Status

Proposed (amended 2026-11-08: one neutral table definition in core, generated DDL, shared queries;
adapter packages stay, thinner). Decision 1 (parity test) is recommended for immediate adoption;
decisions 2 to 5 await owner decision. ADR 0002 describes current behavior until this is accepted.

## Context

Each table is described by hand in up to seven places:

| Description                     | Location                                              | Size (2026-11-02)            |
| ------------------------------- | ----------------------------------------------------- | ---------------------------- |
| SQLite DDL                      | `packages/db-sqlite/src/ddl.ts`                       | 575 lines, 42 `CREATE TABLE` |
| Postgres DDL                    | `packages/db-postgres/src/ddl.ts`                     | 513 lines, 38 `CREATE TABLE` |
| MySQL DDL                       | `packages/db-mysql/src/ddl.ts`                        | 560 lines, 38 `CREATE TABLE` |
| Drizzle schema, one per dialect | `packages/db-{sqlite,postgres,mysql}/src/schema/*.ts` | 32 tables each               |
| Core row types                  | `packages/core/src/schema/*.ts`                       | 23 modules                   |

Additive migrations live in each adapter's `migrate.ts` (for example
`ALTER TABLE projects ADD COLUMN IF NOT EXISTS storybook_meta TEXT` in Postgres), and are a further
hand-maintained copy for upgrades. `docs/repo-structure.md` describes a DDL derived from the entity
modules; that is not true today. Nothing checks that the copies agree.

### Measured drift

A throwaway script compared the column names of every `CREATE TABLE` in each `ddl.ts` with the
columns declared in that dialect's Drizzle schema, and the three DDLs with each other.

- **Real defect.** `users.password_hash`, `display_name_override`, `auth_provider` and `disabled`
  exist in SQLite only. Postgres and MySQL lack them in both DDL and Drizzle, although core
  (`core/src/schema/user.ts`) and auth (`setUserDisabled`, `resolveAuthUser`) depend on them, so
  disabling a user is not persisted on those backends. Tracked as #418 (p0).
- **Intentional, SQLite and Postgres only until #376 (MySQL).** `builds.retention_state`, `build_references`,
  `build_reference_generations`, `build_deletions` and `build_content_releases` (ADR 0039). The
  last two have DDL only, like `build_references`: the lifecycle capability reads and writes them
  with its own SQL, so they need no Drizzle schema or core `Tables` entry until another dialect
  implements the capability.
- **By design.** The auth engine tables (`user`, `session`, `account`, `verification`, `passkey`,
  `ssoProvider`) have DDL in every dialect but no Drizzle schema in the database packages; the auth
  bridge addresses them through its own model registry.
- Otherwise DDL and Drizzle column names agree within each dialect. Types, nullability, defaults
  and indexes were not compared; the parity test in decision 1 must.

The cost of the duplication is concrete: one access-control column was missed in two of three
dialects, and every retention schema change (#374 to #376) must be made correctly in up to seven
places.

### Casts at the model boundary

`DatabaseAdapter` is already generic over Drizzle tables (`get<T extends Table>` returns
`T["$inferSelect"]`). The 142 `as unknown as` casts in `packages/core/src/models` exist because the
core row types (`Build`, `Baseline`, …) are declared separately from the dialect Drizzle types, and
the two differ in shape (boolean modes, timestamp representation, JSON columns). A single source
that generates both would remove most of these casts; better adapter generics alone would not.

### Duplicated query code

The duplication is not only the schema. The retention lifecycle capability (ADR 0039) is
hand-written SQL per dialect: `build-reference-lifecycle.ts` and `build-deletion-steps.ts` are about
800 lines across SQLite and Postgres, and #376 adds a third copy for MySQL. Most statements differ
only in upsert syntax (`ON CONFLICT` against `ON DUPLICATE KEY`), `RETURNING` and row locking. The
fencing strategy really does differ: SQLite relies on its single writer, Postgres locks the
generation row `FOR UPDATE`.

### What differs between the three Drizzle schemas

Diffing a table across dialects (for example `schema/label.ts`) shows the same columns, names,
references and indexes. Only the column helpers differ: booleans (`integer` with
`mode: "boolean"` against `boolean`), timestamps (`text` against `timestamp(…, mode: "string")`),
JSON, and MySQL's need for a `varchar(n)` where a text column is indexed. That difference is
mechanical.

## Options

| Option                                        | What it is                                                                                                                                                                     | Cost                                              | Migration risk                                             | Removes duplication                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| (a) Parity test                               | One test per dialect: every DDL table/column matches the Drizzle schema (name, type family, nullability, default); every core row field maps to a column in all three dialects | Small; no new dependency                          | None                                                       | No, but catches drift in CI                       |
| (b) Generate DDL from Drizzle                 | Build-time generation of each dialect's DDL from its Drizzle schema (drizzle-kit), checked in, with a CI drift check                                                           | Medium; drizzle-kit becomes a dev dependency      | Low for new tables; existing DDL must be proven equivalent | DDL copies (3 of 7)                               |
| (c) A schema DSL in core                      | Our own spec language and a generator for Drizzle schemas, DDL and row types                                                                                                   | Large; a DSL and generator to own                 | High                                                       | Nearly all                                        |
| (d) Neutral tables in core, built per dialect | `defineTable` with a few logical column types; a short per-dialect factory builds the Drizzle table; DDL comes from (b)                                                        | Medium; plain TypeScript, no generator of our own | Medium; every schema import moves                          | Drizzle copies, DDL copies and row types (7 of 7) |

Hand-written DDL relies on features a generator must express: partial and composite indexes,
`ON DELETE CASCADE`, quoted identifiers (`"user"`, `"ssoProvider"`), dialect defaults and the
additive `ALTER` migrations. Options (b) and (d) must be checked against each before adoption.

## Decision

1. **Adopt (a) now** as a guard, and keep it after (d) lands as the equivalence proof. The test
   lives in each adapter package next to `ddl.ts`, runs in `nub run test` (hermetic: parse the DDL
   text and read Drizzle `getTableColumns`), and asserts that each core row field exists in all
   three dialects unless listed in an explicit, commented allowlist.
2. **Target (d).** Each table is defined once in `packages/core/src/db/tables/` with `defineTable`
   and logical column types: `id`, `text`, `key` (indexed text: `varchar(n)` in MySQL), `int`,
   `bool`, `timestamp`, `json<T>` and `enumOf<T>`, plus references, indexes and partial indexes.
   Each adapter has one factory (about 50 lines) that maps them to `sqliteTable`, `pgTable` or
   `mysqlTable`. The factories fix the modes (timestamps as ISO strings, booleans as booleans,
   JSON as text), so all three dialects infer the same row type; the core row types become
   `InferSelect` of the neutral table and most of the 142 model casts go. Core already depends on
   `drizzle-orm`, so this adds no dependency. It is plain TypeScript, not a DSL with a generator,
   which is why it is preferred to (c).
3. **DDL is generated, (b) on top of (d).** `drizzle-kit` generates each dialect's DDL from the
   built tables. The output is checked in, and CI fails when it drifts. The auth engine tables keep
   their hand-written DDL until the auth bridge's registry can be expressed the same way.
4. **Migrations last.** Once the DDL is generated, migrations are generated per dialect and
   versioned, starting from a baseline that represents today's schema, so an existing install
   upgrades without a history it never had. Until then, the hand-written additive `ALTER`s stay.
5. **Shared queries, dialect-specific fencing.** A capability is written once against the Drizzle
   query builder, with the few differing statements (upsert, `RETURNING`, row lock) behind a small
   `Dialect` interface in core. The fence and transaction strategy stays per dialect, because it
   really differs. The shared contract suites (ADR 0039) prove each dialect.

## Adapter packages

The three packages stay, made thin. What remains in each:

- **The drivers and presets.** Each package owns its drivers under the one-owner rule
  (`postgres`, `mysql2`; optional peers such as `pg`, `@neondatabase/serverless`,
  `@electric-sql/pglite`, `@planetscale/database`, `@libsql/client`). A user installs only the
  driver they run, which keeps serverless bundles small.
- **The dialect factory, the `Dialect` implementation and the fence.**
- **The generated DDL and migrations**, as build output checked in beside them.

Tables, row types and shared queries move to core. Merging the three into one `@storyshelf/db` with
subpath exports was considered: it would turn every driver into an optional peer, rename the
packages people install (a breaking change) and save little once each is thin. It is not adopted.

## Follow-up tasks

Data lane, after #376:

1. Parity test for SQLite, Postgres and MySQL, plus the allowlist.
2. Spike: build three tables (`labels`, `builds`, `users`) through `defineTable` and a factory per
   dialect, generate the DDL with `drizzle-kit`, and diff it against today's `ddl.ts`. If a feature
   cannot be expressed, record it here and stop at (a).
3. Move the remaining tables; derive the core row types; remove the model casts.
4. DDL generation with a CI drift check; remove the hand-written `ddl.ts` files.
5. The `Dialect` interface, and the retention lifecycle written once.
6. Generated migrations from a baseline.
7. Correct `docs/repo-structure.md` and `docs/architecture/` to describe the model.

## Consequences

**Positive**

- A schema change is one edit, not up to seven; drift fails CI instead of reaching an operator.
- About 3,000 lines of near-duplicate schema, DDL and query code go, with most model casts.
- A new dialect is a factory, a `Dialect` and a fence, not a port of every table and statement.

**Negative**

- `drizzle-kit` becomes a dev dependency and every schema change has a regeneration step.
- The neutral column vocabulary is ours to maintain; a column it cannot express needs a new
  logical type, not a one-off in one dialect.
- Every schema import moves, so steps 3 to 5 touch most models and all three adapters.
