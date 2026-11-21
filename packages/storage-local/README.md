# @storyshelf/storage-local (deprecated)

**Deprecated.** Local filesystem storage is built into core. Import it from
`@storyshelf/core/storage/local`; the factory and its options are unchanged.

```ts
// before
import { createLocalStorage } from "@storyshelf/storage-local";
// after
import { createLocalStorage } from "@storyshelf/core/storage/local";
```

This package re-exports the core subpath for one minor release (ADR 0049), then is no longer
published. Remove it from your `package.json` and keep `@storyshelf/core`.
