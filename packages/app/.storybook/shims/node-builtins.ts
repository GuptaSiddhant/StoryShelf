import { sha256 } from "./sha256.ts";

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

/** Default import of a built-in (`import path from "node:path"`). */
export default {};

const fn =
  (name: string) =>
  (..._args: unknown[]): never =>
    unavailable(name);

/**
 * Safe stand-ins: core computes its scratch directory (`join(tmpdir(), "storyshelf")`) when
 * `options.ts` loads, so the dev server, which does not tree-shake, calls both on every page that
 * imports core's config. Nothing reads the path in a story.
 */
export const join = (...parts: string[]): string => parts.join("/").replaceAll(/\/+/gu, "/");
export const resolve = fn("path.resolve");
export const relative = fn("path.relative");
export const normalize = fn("path.normalize");
export const dirname = fn("path.dirname");
export const isAbsolute = fn("path.isAbsolute");
export const sep = "/";
export const realpathSync = fn("fs.realpathSync");
export const posix = { join: fn("path.posix.join"), sep: "/" };
export const fileURLToPath = fn("url.fileURLToPath");
export const pathToFileURL = fn("url.pathToFileURL");
export { Buffer } from "./buffer.ts";
export const createHmac = fn("crypto.createHmac");
export const createCipheriv = fn("crypto.createCipheriv");
export const createDecipheriv = fn("crypto.createDecipheriv");
export const randomBytes = fn("crypto.randomBytes");
export const randomUUID = fn("crypto.randomUUID");
export const timingSafeEqual = fn("crypto.timingSafeEqual");
export const crc32 = fn("zlib.crc32");
export const inflateRawSync = fn("zlib.inflateRawSync");
export const setImmediate = fn("timers/promises.setImmediate");

// node:dns/promises, node:net: core's outbound guard builds its block list when it loads, so the
// list is a no-op stand-in; a story never sends a request.
export const lookup = fn("dns/promises.lookup");
export const isIP = fn("net.isIP");
export function BlockList(): { addSubnet: () => void; check: () => boolean } {
  return { addSubnet: (): void => {}, check: (): boolean => true };
}

// node:os
export const totalmem = (): number => 0;
export const availableParallelism = (): number => 1;
export const tmpdir = (): string => "/tmp";

// node:stream: present so modules that extend or reference them still load; never constructed.
export function Readable(): void {}
export function Transform(): void {}

/** node:async_hooks: a synchronous stand-in (a story renders one page at a time). */
export class AsyncLocalStorage<T> {
  #store: T | undefined;
  run<R>(store: T, callback: () => R): R {
    const previous = this.#store;
    this.#store = store;
    try {
      return callback();
    } finally {
      this.#store = previous;
    }
  }
  getStore(): T | undefined {
    return this.#store;
  }
}

// node:fs, node:fs/promises, node:perf_hooks
export const readFile = fn("fs.readFile");
export const readFileSync = fn("fs.readFileSync");
export const readdir = fn("fs.readdir");
export const rm = fn("fs.rm");
export const monitorEventLoopDelay = fn("perf_hooks.monitorEventLoopDelay");
export const createWriteStream = fn("createWriteStream");
export const mkdir = fn("mkdir");
export const pipeline = fn("pipeline");
export const rmdir = fn("rmdir");
export const stat = fn("stat");
export const createRequire = fn("createRequire");
export const execFileSync = fn("execFileSync");
export const hostname = fn("hostname");
export const isMainThread = fn("isMainThread");

// node:crypto.createHash("sha256"): core hashes content (component fingerprints) while a page
// renders, so this is a real, synchronous SHA-256 (see `sha256.ts`).
interface Hasher {
  update(data: string | Uint8Array): Hasher;
  digest(encoding: "hex"): string;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const all = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all;
}

export function createHash(algorithm: string): Hasher {
  if (algorithm !== "sha256") unavailable(`crypto.createHash("${algorithm}")`);
  const chunks: Uint8Array[] = [];
  const hasher: Hasher = {
    update: (data) => {
      chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data);
      return hasher;
    },
    digest: () => sha256(concat(chunks)),
  };
  return hasher;
}
