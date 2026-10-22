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

Today both are thin aliases over the same `mysql2` pool: PlanetScale and TiDB Serverless speak the MySQL wire protocol, so the standard options above work unchanged (use `ssl` as your provider requires). They take the same options as `createMysqlDatabase`.

## Other exports

| Subpath                       | Contents                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `@storyshelf/db-mysql/schema` | The Drizzle table definitions.                                                              |
| `@storyshelf/db-mysql/ddl`    | The canonical `DDL` string for every table and index, for provisioning outside the adapter. |

## License

MIT
