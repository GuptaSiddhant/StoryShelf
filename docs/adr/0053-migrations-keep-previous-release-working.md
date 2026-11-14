# ADR 0053: Migrations Keep the Previous Release Working

## Status

Accepted (2026-11-13, owner). It answers #913 under epic #889 and is a
precondition of scaling by identical copies (ADR 0050, decision 6). It adds a rule to ADR 0002 and
ADR 0041; it does not replace them. Statements marked `[inferred]` were not read in the code and must
be confirmed by the implementation.

## Context

ADR 0050 scales the app by running more identical copies against one Postgres. A rolling deploy
therefore runs two releases against one database: the first new copy migrates at boot while old
copies still serve requests and consume the queue. Nothing written down says a migration must leave
the old copies working.

Facts read in the code on 2026-11-13:

- **Migrations run at every boot and are not versioned.** `runMigrations`
  (`packages/db-postgres/src/migrate.ts`) runs the full DDL with `IF NOT EXISTS`, then a fixed list
  of idempotent `ALTER` statements. There is no record of which release last migrated
  `[inferred: no version table found]`.
- **Postgres serialises migrations.** `runMigrationsLocked` holds a session-level advisory lock
  (#803, #830). No equivalent was found for MySQL `[inferred]`. SQLite is one process.
- **The list already drops things at boot.** For example `DROP TABLE IF EXISTS figma_nodes` and
  `ALTER TABLE webhooks DROP COLUMN IF EXISTS secret`. With one copy that was safe.
- **The list sets defaults at boot.** `ALTER TABLE projects ALTER COLUMN run_a11y SET DEFAULT true`
  runs on every start. An old copy that restarts during a rollout would re-apply its own version of
  such a statement.
- **A consumer fails a job it does not understand.** `run-job.ts` fails a job whose kind has no
  handler. An old copy that claims a new kind of job ends it for good.
- **Job payloads carry no version.** The payload is JSON with a request id, a trace parent and
  kind-specific fields.
- **Releases are weekly minors.** Before 1.0 a breaking change is a minor release (ADR 0043).
- **Versioned migrations are planned, last.** ADR 0041 generates and versions migrations once the
  neutral tables exist. Until then the hand-written lists stay.

## Decision

### 1. The compatibility window is one minor release

- Release N must work, unchanged, against the schema left by release N+1. "Work" means serve
  requests, consume the queue and pass its own smoke test.
- The window is counted in minor releases. A patch release may expand the schema and may never
  contract it.
- A rolling upgrade is supported from the previous minor only. Skipping minors is still supported,
  but only with every copy stopped first; the release notes say so.
- A consequence: rolling back one minor is always safe, for the same reason.

### 2. The database records its schema level

- A one-row table, `schema_meta`, holds the release that last migrated the database.
- At boot a copy compares its own release with that value:
  - **equal or older database:** migrate, then write its own release;
  - **database one minor newer:** skip migrations entirely and start. The schema is compatible by
    decision 1;
  - **database more than one minor newer:** refuse to start, with a message naming both versions.
- The table is created in the release that adopts this ADR. A database without it is treated as
  "older".
- This becomes the version record ADR 0041's generated migrations need; they reuse it.

### 3. Expand and contract

Every schema statement is one of two kinds, and the code says which (two lists per dialect).

| Kind   | Allowed in any release                                                |
| ------ | --------------------------------------------------------------------- |
| Expand | Create a table                                                        |
| Expand | Add a nullable column, or a `NOT NULL` column with a constant default |
| Expand | Add a non-unique index (built as in decision 4)                       |
| Expand | Widen a column's type or length                                       |

| Kind     | Allowed only one minor after the last release that used the thing |
| -------- | ----------------------------------------------------------------- |
| Contract | Drop a table, a column, an index or a default                     |
| Contract | Add `NOT NULL`, a unique index, a check or a foreign key          |
| Contract | Narrow a type                                                     |

- "Used" means read or written by any code path of that release, including its migrations.
- A column is never renamed in place, and a type is never changed in place.
- Changing a default is a contract step when the previous release relies on the old one.
- The drops already in the lists stay as they are; they are older than any supported rolling
  upgrade.

### 4. How common changes are split

**Rename a column** (three releases):

| Release | Schema              | Code                                                         |
| ------- | ------------------- | ------------------------------------------------------------ |
| N       | Add the new column  | Write both; read the new one, fall back to the old; backfill |
| N+1     | None                | Read and write only the new column                           |
| N+2     | Drop the old column | None                                                         |

The drop cannot be in N+1: while N+1 rolls out, copies of N still write the old column.

**Drop a column** (two releases):

- N: stop reading and writing it. If it is `NOT NULL` without a default, N also gives it a default,
  so that N+1's inserts, which omit it, still succeed.
- N+1: drop it.

**Add `NOT NULL` to an existing column** (two releases):

- N: every writer sets a value; a backfill fills the old rows.
- N+1: add the constraint, after checking that no null rows remain. On Postgres use a check
  constraint added `NOT VALID`, then validated, then `SET NOT NULL`, so the table is not locked for
  a full scan.

**Build an index:**

- Postgres: `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, outside a transaction. A failed build leaves
  an invalid index; the migration drops an invalid index of that name before retrying.
- MySQL: `ALGORITHM=INPLACE, LOCK=NONE`.
- SQLite: a plain `CREATE INDEX`; there is one process.
- A unique index is a contract step. It is added only after a release whose writers already keep
  the values unique, and the existing duplicate check runs first.

**Every statement that needs a table lock** sets a short lock timeout first (5 seconds, proposal)
and retries. A migration that waits for a lock behind a long transaction blocks every other query
on that table, which is worse than a failed boot.

### 5. New values and new jobs: readers first

- **Status and enum values.** A value may be written only by a release whose predecessor can
  already read it. Release N teaches every reader the value; release N+1 may write it. A reader that
  meets a value it does not know leaves the row alone: it never treats it as terminal, never
  rewrites it and never fails on it.
- **Job kinds.** A consumer claims only the kinds it has a handler for. The claim query filters on
  kind, so an old copy never sees a new kind. This filter ships in the release that adopts this
  ADR; a new job kind may first be enqueued in the release after it.
- **Job payloads.** Every payload carries a version number. A consumer that meets a higher version
  than it supports hands the job back without spending a retry.
- These three rules replace today's behaviour of failing a job that has no handler.

### 6. New invariants: writers first, enforcement second

A rule that the database or a fenced update enforces is a contract step, because the previous
release does not follow it yet.

- Release N writes whatever the new rule needs (a generation column, a state, a reference).
- Release N+1 turns enforcement on.
- This applies to the retention lifecycle of ADR 0039. A new retention state, fence or reference
  column follows decisions 5 and 6, so that an old copy can never delete or promote something the
  new copy considers protected. If that cannot be done in two steps, the change needs every copy
  stopped, and the release notes say so.

### 7. Backfills

- **Not in the boot migration**, unless it is one statement over an indexed range that is known to
  be small. The migration holds the advisory lock, and other copies wait behind it.
- **Otherwise a backfill is a job on the database queue**, following ADR 0040: its own handler, a
  single-flight key so that one runs at a time, and its retry limit declared with its queue.
- **It works in batches.** Each batch is one short transaction over a primary-key range (1,000 rows,
  proposal) and stores its cursor.
- **It is idempotent.** Every batch selects only rows that still need the change, for example
  `WHERE new_column IS NULL`. Running it twice, or on two copies, changes nothing.
- **Reads never depend on it.** Until the contract step, code reads the new shape and falls back to
  the old one.
- **The contract step checks first.** The migration that contracts verifies that no row still needs
  the backfill. If some do, which happens when a minor was skipped, it finishes the backfill inline
  and logs a warning. Skipped upgrades are done with every copy stopped (decision 1).

### 8. How CI proves it

- **A static check, in `nub run test`.** It parses each dialect's migration statements and fails on
  a drop, a rename, a `NOT NULL` addition, a unique index or a type change that is not in the
  contract list. Each contract entry names the last release that used the thing, and the check
  fails unless that release is at least one minor behind the version being built.
- **A previous-release job, on pull requests that touch a schema or migration file.** For Postgres:
  1. migrate an empty database with the last released tag;
  2. migrate it again with the pull request's code;
  3. start the last released tag against it (it skips migrations, by decision 2);
  4. run that tag's smoke script and its database contract suites.
- **A mixed-queue test.** The new code enqueues every job kind; the previous release's consumer
  runs beside the new one; no job ends failed because of its kind or payload version.
- **MySQL** runs the same job nightly `[inferred: alongside the existing nightly database job]`.
  **SQLite** runs only steps 1 and 2: it has no rolling deploy, but the upgrade path must work.
- Until the first release that contains `schema_meta`, step 3 cannot skip migrations. The job
  starts enforcing from the release after adoption.

### 9. ADR 0041 and the three dialects

- **Until the neutral tables land:** the rule applies to the hand-written lists. A change is made in
  every dialect's DDL, Drizzle schema and migration, plus the core row type, as AGENTS.md says, and
  is marked expand or contract in each.
- **After they land:** generated migrations are versioned per dialect and recorded in
  `schema_meta`. A generator that emits a rename or a drop as one statement `[inferred]` has that
  output split by hand into the steps of decision 4, and the static check of decision 8 runs on the
  generated SQL.
- **The promise differs by dialect, the rule does not.** Rolling upgrades are promised on Postgres,
  which is what the ADR 0050 modules create. MySQL follows the same rule and is proven nightly.
  SQLite follows it so that one set of migrations has one meaning.

### 10. Release notes

A pull request that changes the schema says so in its changeset, in a line that starts with
`Schema:`. The release notes then carry a "Database" section that states:

- each expand step, and each contract step with the release that stopped using the thing;
- each backfill: what it does, roughly how long it takes per million rows, and how to see that it
  finished;
- the oldest release a rolling upgrade is supported from;
- whether any step needs every copy stopped, and why.

A release with no schema change says "No schema changes."

## Consequences

- A rename takes three weekly releases and a drop takes two. That is slow on purpose.
- Dead columns live for a release or two, and code carries read fallbacks for as long.
- One-step rollback becomes safe, which the cloud modules can rely on.
- The claim filter and the payload version are prerequisites: once this ADR is adopted, no new job
  kind and no new status value may ship until one release after the filter. ADR 0044's `skipped`
  status is the first case.
- The previous-release job adds a database job to pull requests that touch the schema, and it
  depends on release tags being buildable.
- An operator who skips minors must stop every copy. That was always true; now it is written down.

## Alternatives considered

- **Stop every copy for every upgrade.** Simple and safe, and still the fallback. Rejected as the
  default: it removes the reason for running several copies.
- **A separate migration step before the deploy.** Rejected for now: ADR 0050 keeps one image that
  migrates at boot, and a separate step does not remove the need for old code to work on the new
  schema.
- **Blue-green with two databases.** Rejected: it needs data replication between schemas, far
  beyond a self-hosted tool.
- **Nullable columns only, as #913 first put it.** Narrowed instead: a `NOT NULL` column with a
  constant default is safe for old writers and is what the existing migrations already do.
- **Rely on review instead of a check.** Rejected: the existing lists already contain boot-time
  drops, written when one copy was the only case.
