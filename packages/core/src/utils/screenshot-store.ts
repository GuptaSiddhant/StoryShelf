/** Content-addressed screenshot storage: identical bytes are stored once per project. */
import { createHash } from "node:crypto";
import type { StorageAdapter } from "../adapters/storage.ts";
import { contentPath } from "./paths.ts";

/**
 * Store a screenshot under the SHA-256 of its bytes and return its path.
 *
 * An unchanged story renders the same bytes build after build, so the object usually exists
 * already and nothing is uploaded. Snapshots and baselines then point at the same object, and
 * identical paths mean identical pixels (the diff can be skipped without reading either image).
 */
export async function storeScreenshot(
  storage: StorageAdapter,
  projectId: string,
  data: Buffer,
): Promise<string> {
  const path = contentPath(projectId, createHash("sha256").update(data).digest("hex"));
  if (!(await storage.exists(path))) {
    await storage.write(path, data);
  }
  return path;
}
