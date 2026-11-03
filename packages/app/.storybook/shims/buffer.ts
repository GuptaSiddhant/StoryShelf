/**
 * A minimal `Buffer` for the Storybook bundle, which runs in a browser. Core's built modules
 * build constants with it at import time (`Buffer.from([137, 80, …])` for the PNG signature,
 * `Buffer.alloc(0)`), and the dev server loads those modules unbundled, so the global must exist
 * and work before any story is imported. Only what is used at load time is implemented; reading
 * and writing real files never happens in a story.
 */
type Source = string | ArrayBufferLike | ArrayLike<number>;

function from(source: Source): Uint8Array {
  if (typeof source === "string") return new TextEncoder().encode(source);
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return Uint8Array.from(source as ArrayLike<number>);
}

function alloc(size: number): Uint8Array {
  return new Uint8Array(size);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function isBuffer(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

export const Buffer = { from, alloc, concat, isBuffer };
