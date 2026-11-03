import { Buffer } from "./buffer.ts";

/**
 * Browser stand-ins for Node globals that `@storyshelf/core` uses while loading. Imported first by
 * `preview.ts`, so it runs before any story module (and so before core) is evaluated.
 */
if (Reflect.get(globalThis, "Buffer") === undefined) {
  Reflect.set(globalThis, "Buffer", Buffer);
}
