# @storyshelf/common

The lightweight code StoryShelf packages share, in one small package. Its only runtime dependency is `@opentelemetry/api`, which does nothing until an SDK registers, and it never imports another `@storyshelf/*` package. A package that needs only this (`@storyshelf/mcp`, `@storyshelf/observability`) no longer installs all of `@storyshelf/core`.

## Install

```sh
nub add @storyshelf/common
```

or

```sh
npm install @storyshelf/common
```

## Subpaths

| Subpath | What it holds |
| --- | --- |
| `@storyshelf/common/settings` | `readSetting`, `RENAMED_SETTINGS`, `refuseRenamedSettings`, `RenamedSettingError`: StoryShelf's own `SHELF_*` environment variables |
| `@storyshelf/common/http` | `httpJson`, `httpText`, `HttpError`, `guardedFetch`, `assertOutboundUrl`: outbound HTTP that refuses private addresses and unsafe redirects |
| `@storyshelf/common/redact` | `redactSecrets`, `redactUrlForLog`, `sanitizeErrorText`, and the Storybook token prefixes it scrubs |
| `@storyshelf/common/tracing` | `withSpan`, `spanException`, W3C propagation and the memoized instruments |
| `@storyshelf/common/errors` | `UserFacingError`, `isUserFacingError`, `errorText` |
| `@storyshelf/common/ids` | `ulid`, `slugify`, `sha256`, `timingSafeEqualString` |
| `@storyshelf/common/logger` | the `Logger` type (a pino logger satisfies it) |

```ts
import { httpJson } from "@storyshelf/common/http";
import { readSetting } from "@storyshelf/common/settings";

const url = readSetting(process.env, "SHELF_URL");
const health = url === undefined ? undefined : await httpJson<{ ok: boolean }>(`${url}/api/v1/health`);
```

`@storyshelf/core` re-exports everything that lives here from its existing subpaths, so code written against core keeps working.

## License

MIT
