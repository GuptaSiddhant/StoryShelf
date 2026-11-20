# @storyshelf/db-mysql

MySQL/MariaDB database adapter for StoryShelf (mysql2 + Drizzle). PlanetScale and TiDB presets are available via the `./planetscale` and `./tidb` subpaths.

## Install

```sh
nub add @storyshelf/db-mysql
```

or

```sh
npm install @storyshelf/db-mysql
```

## Usage

```ts
import { createMysqlDatabase } from "@storyshelf/db-mysql";

const db = createMysqlDatabase({ url: "mysql://user:pass@localhost:3306/shelf" });
```

See the [StoryShelf documentation](https://github.com/GuptaSiddhant/StoryShelf#readme) for configuration details.

## Configure

```ts
import { createMysqlDatabase } from "@storyshelf/db-mysql";

const database = createMysqlDatabase({
  url: process.env.DATABASE_URL!, // mysql://user:pass@host:3306/shelf
});
```

Provide one of:

- `url` / `connectionString` — a MySQL connection URL.
- `host` (with `port`, `user`, `password`, `database`, `ssl`, `connectionLimit`) — discrete options; the pool defaults to 10 connections.
- `client` — a preconfigured `mysql2` pool or connection. When you inject a client you own its lifecycle; the adapter only closes pools it created.

Migrations run inside the adapter's `migrate` hook — await them via `app.lifecycle.setup()` after creating the app. The adapter implements `DatabaseAdapter` (`insert`, `update`, `get`, `remove`, `list`, `count`, `all`) plus a `ping` used by health checks.

## Presets

Two preset entry points exist so generated servers and the CLI can import a provider-named factory:

```ts
import { createPlanetscaleDatabase } from "@storyshelf/db-mysql/planetscale";
import { createTidbDatabase } from "@storyshelf/db-mysql/tidb";
```

Today both are thin aliases over the same `mysql2` pool: PlanetScale and TiDB Serverless speak the MySQL wire protocol, so the standard options above work unchanged (use `ssl` as your provider requires). They take the same options as `createMysqlDatabase`. Neither provides build retention (see below): their locking was never proven.

## Build retention

With `testing` on, build purge and branch GC need the fenced retention lifecycle (ADR 0039). This
adapter provides it only where it was proven against a real server:

- `createMysqlDatabase` with a **pool** (a `url`, `host` options, or an injected `mysql2` `Pool`);
- on **MySQL 8**, with the lifecycle tables on **InnoDB** and the binary log, if enabled, not
  `STATEMENT`-based (`ROW`, the default, or `MIXED`).

Each lifecycle operation borrows its own pooled connection and runs at `READ COMMITTED`, whatever
the server's default isolation. Anything else keeps retention **off** (no automatic build deletion or
branch GC; admin purge answers `503`) and logs the reason once at boot: the PlanetScale and TiDB
presets, an injected single `Connection`, MariaDB, TiDB, Vitess, or another MySQL version.

Upgrading: the migration adds `builds.retention_state` (default `available`) and four lifecycle
tables; nothing is dropped, so the previous release keeps running on the new schema. The first boot
then pins the source build of every baseline before it turns retention on. Upgrade **every**
instance that shares the database before relying on purge: an older instance writes baselines
without the fence. A baseline whose recorded source build is being deleted or belongs to another
project pauses retention instead (the System page names both ids); fix the data and restart.

## Other exports

| Subpath                       | Contents                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `@storyshelf/db-mysql/schema` | The Drizzle table definitions.                                                              |
| `@storyshelf/db-mysql/ddl`    | The canonical `DDL` string for every table and index, for provisioning outside the adapter. |

## License

MIT
