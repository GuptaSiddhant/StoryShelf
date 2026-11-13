/** Reading a published build's files from storage. */
import { posix } from "node:path";
import type { Readable } from "node:stream";
import type { StorageAdapter } from "../../adapters/storage.ts";
import { contentKey, storybookDir } from "../../utils/paths.ts";
import { isStorageNotFound } from "../../utils/storage-not-found.ts";
import { loadManifest } from "./manifest-cache.ts";

/** Where a published file lives in storage, and its manifest identity when content-addressed. */
export interface PublishedFileLocation {
  /** The storage key of the bytes. */
  path: string;
  /** The manifest content hash; absent for a build published before manifests. */
  contentHash?: string;
}

/**
 * A file of a build's published Storybook by its path inside the build, or null when it is gone.
 * Content-addressed builds answer through their manifest; older ones from the per-build copy.
 */
export async function readPublishedFile(
  storage: StorageAdapter,
  projectId: string,
  buildId: string,
  rel: string,
): Promise<Buffer | null> {
  return (await readPublishedFileInfo(storage, projectId, buildId, rel))?.bytes ?? null;
}

/** Published bytes and, for content-addressed files, their manifest identity. */
export async function readPublishedFileInfo(
  storage: StorageAdapter,
  projectId: string,
  buildId: string,
  rel: string,
): Promise<{ bytes: Buffer; contentHash?: string } | null> {
  const found = await openPublishedFile(storage, projectId, buildId, rel, "bytes");
  return found?.bytes ? { bytes: found.bytes, ...hashOf(found) } : null;
}

/**
 * The storage key of a published file from the (cached) manifest alone, with no storage call once
 * the manifest is warm, or the per-build key for a build without one. It does not check the object.
 */
export async function locatePublishedFile(
  storage: StorageAdapter,
  projectId: string,
  buildId: string,
  rel: string,
): Promise<PublishedFileLocation> {
  const dir = storybookDir(projectId, buildId);
  const hash = (await loadManifest(storage, dir))?.get(rel);
  const content = hash === undefined ? undefined : contentPath(hash);
  if (hash !== undefined && content !== undefined) {
    return { path: content, contentHash: hash };
  }
  return { path: posix.join(dir, rel) };
}

/** An opened published file: its bytes or a stream of them, with the manifest hash if any. */
export interface OpenedPublishedFile extends PublishedFileLocation {
  bytes?: Buffer;
  stream?: Readable;
}

/**
 * Open a published file with one storage read: a miss is the adapter's not-found, never a prior
 * `exists`. A manifest entry whose content is gone falls back to the per-build copy, as does a
 * file the manifest does not list; any other storage failure is thrown.
 */
export async function openPublishedFile(
  storage: StorageAdapter,
  projectId: string,
  buildId: string,
  rel: string,
  as: "bytes" | "stream",
): Promise<OpenedPublishedFile | null> {
  const located = await locatePublishedFile(storage, projectId, buildId, rel);
  const first = await openAt(storage, located, as);
  if (first || located.contentHash === undefined) {
    return first;
  }
  const legacy = { path: posix.join(storybookDir(projectId, buildId), rel) };
  return await openAt(storage, legacy, as);
}

async function openAt(
  storage: StorageAdapter,
  location: PublishedFileLocation,
  as: "bytes" | "stream",
): Promise<OpenedPublishedFile | null> {
  try {
    return as === "bytes"
      ? { ...location, bytes: await storage.read(location.path) }
      : { ...location, stream: await storage.readStream(location.path) };
  } catch (error) {
    if (isStorageNotFound(error)) return null;
    throw error;
  }
}

function hashOf(file: PublishedFileLocation): { contentHash?: string } {
  return file.contentHash === undefined ? {} : { contentHash: file.contentHash };
}

/** The content key of a manifest hash, or undefined when the hash is malformed. */
function contentPath(hash: string): string | undefined {
  try {
    return contentKey(hash);
  } catch {
    return undefined;
  }
}
