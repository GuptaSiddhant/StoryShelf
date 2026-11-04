import { Buffer } from "./buffer.ts";

/**
 * Browser stand-ins for Node globals that `@storyshelf/core` uses while loading. Imported first by
 * `preview.ts`, so it runs before any story module (and so before core) is evaluated.
 */
if (Reflect.get(globalThis, "Buffer") === undefined) {
  Reflect.set(globalThis, "Buffer", Buffer);
}

/**
 * `process.env` is read when a page asks core whether the host is serverless (the git channel form).
 * The production build never reaches it, but the dev server does not tree-shake: an empty
 * environment means "not serverless".
 */
if (Reflect.get(globalThis, "process") === undefined) {
  Reflect.set(globalThis, "process", { env: {} });
}
