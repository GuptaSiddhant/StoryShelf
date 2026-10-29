/** Reading a published build's files from storage. */
import { posix } from "node:path";
import type { StorageAdapter } from "../../adapters/storage.ts";
import { storybookDir } from "../../utils/paths.ts";

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
  const dir = storybookDir(projectId, buildId);
  const viaManifest = await readViaManifest(storage, dir, rel);
  if (viaManifest) {
    return viaManifest;
  }
  const legacy = posix.join(dir, rel);
  return (await storage.exists(legacy)) ? { bytes: await storage.read(legacy) } : null;
}

async function readViaManifest(
  storage: StorageAdapter,
  dir: string,
  rel: string,
): Promise<{ bytes: Buffer; contentHash: string } | null> {
  try {
    const manifestPath = posix.join(dir, "manifest.json");
    if (!(await storage.exists(manifestPath))) {
      return null;
    }
    const manifest = JSON.parse((await storage.read(manifestPath)).toString("utf8")) as Record<
      string,
      string
    >;
    const hash = manifest[rel];
    if (!hash) return null;
    const path = `content/${hash}`;
    return (await storage.exists(path))
      ? { bytes: await storage.read(path), contentHash: hash }
      : null;
  } catch {
    // an unreadable manifest falls back to the per-build copy
    return null;
  }
}
