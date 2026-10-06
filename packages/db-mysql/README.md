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

## License

MIT
