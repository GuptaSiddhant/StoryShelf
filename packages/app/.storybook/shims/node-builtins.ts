/**
 * Story-only stand-in for the Node built-ins that `@storyshelf/core` imports (path, url, buffer,
 * zlib, crypto, timers/promises). Pages import core's types, URL builder and model helpers, but a
 * story never reaches the code that needs Node, so each name here throws if one is ever called.
 * It keeps the browser bundle free of "externalized for browser compatibility" noise.
 */
function unavailable(name: string): never {
  throw new Error(
    `node:${name} is not available in Storybook: pass the data to the story instead.`,
  );
}

const fn =
  (name: string) =>
  (..._args: unknown[]): never =>
    unavailable(name);

export const join = fn("path.join");
export const resolve = fn("path.resolve");
export const relative = fn("path.relative");
export const normalize = fn("path.normalize");
export const dirname = fn("path.dirname");
export const isAbsolute = fn("path.isAbsolute");
export const sep = "/";
export const posix = { join: fn("path.posix.join"), sep: "/" };
export const fileURLToPath = fn("url.fileURLToPath");
export const pathToFileURL = fn("url.pathToFileURL");
export const Buffer = { from: fn("buffer.from") };
export const createHash = fn("crypto.createHash");
export const createHmac = fn("crypto.createHmac");
export const createCipheriv = fn("crypto.createCipheriv");
export const createDecipheriv = fn("crypto.createDecipheriv");
export const randomBytes = fn("crypto.randomBytes");
export const randomUUID = fn("crypto.randomUUID");
export const timingSafeEqual = fn("crypto.timingSafeEqual");
export const crc32 = fn("zlib.crc32");
export const inflateRawSync = fn("zlib.inflateRawSync");
export const setImmediate = fn("timers/promises.setImmediate");
