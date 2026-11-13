/**
 * A bounded in-process cache of parsed build manifests. A published manifest never changes (it is
 * written last), so a hit costs no storage call. It is kept per storage adapter and keyed by the
 * build's directory (project and build id), so one build's manifest is never served for another.
 * A missing or unreadable manifest is never cached: a build still publishing gets one later.
 */
import { posix } from "node:path";
import type { StorageAdapter } from "../../adapters/storage.ts";

/** A build's manifest: the content hash of each published file by its path. */
export type BuildManifest = ReadonlyMap<string, string>;

/** Manifests kept in memory per storage adapter (least recently used leave first). */
export const MANIFEST_CACHE_SIZE = 64;

interface Cache {
  manifests: Map<string, BuildManifest>;
  inflight: Map<string, Promise<BuildManifest | null>>;
}

const caches = new WeakMap<StorageAdapter, Cache>();

/**
 * The manifest of the build whose Storybook lives in `dir`, or null when it has none yet (a build
 * published before manifests, or one still publishing) or it cannot be read.
 */
export async function loadManifest(
  storage: StorageAdapter,
  dir: string,
): Promise<BuildManifest | null> {
  const cache = cacheOf(storage);
  const hit = cache.manifests.get(dir);
  if (hit) {
    remember(cache, dir, hit);
    return hit;
  }
  const pending = cache.inflight.get(dir) ?? fetchManifest(storage, dir);
  cache.inflight.set(dir, pending);
  return await settle(cache, dir, pending);
}

async function settle(
  cache: Cache,
  dir: string,
  pending: Promise<BuildManifest | null>,
): Promise<BuildManifest | null> {
  try {
    const manifest = await pending;
    if (manifest) remember(cache, dir, manifest);
    return manifest;
  } finally {
    cache.inflight.delete(dir);
  }
}

/** Forget a build's manifest (its Storybook was deleted). */
export function forgetManifest(storage: StorageAdapter, dir: string): void {
  caches.get(storage)?.manifests.delete(dir);
}

function cacheOf(storage: StorageAdapter): Cache {
  let cache = caches.get(storage);
  if (!cache) {
    cache = { manifests: new Map(), inflight: new Map() };
    caches.set(storage, cache);
  }
  return cache;
}

function remember(cache: Cache, dir: string, manifest: BuildManifest): void {
  cache.manifests.delete(dir);
  cache.manifests.set(dir, manifest);
  const oldest = cache.manifests.keys().next().value;
  if (cache.manifests.size > MANIFEST_CACHE_SIZE && oldest !== undefined) {
    cache.manifests.delete(oldest);
  }
}

async function fetchManifest(storage: StorageAdapter, dir: string): Promise<BuildManifest | null> {
  try {
    return parseManifest(await storage.read(posix.join(dir, "manifest.json")));
  } catch {
    // a missing or unreadable manifest falls back to the per-build copy, and is not cached
    return null;
  }
}

function parseManifest(bytes: Buffer): BuildManifest | null {
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const entries = Object.entries(parsed).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return new Map(entries);
}
