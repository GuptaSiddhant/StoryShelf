/** Content-addressed screenshot storage: identical bytes are stored once per project. */
import { createHash } from "node:crypto";
import type { StorageAdapter } from "../adapters/storage.ts";
import { contentDir, contentPath } from "./paths.ts";
import { ulid } from "./ulid.ts";

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

/** Folder inside a project's content directory holding in-flight reuse claims. */
export const CLAIMS_DIR = ".claims";

/**
 * Run `work` under a reuse claim the screenshot sweep honours: while the claim exists (and is
 * younger than the sweep's grace period) nothing in the project's content is deleted. For work
 * outside a capture that reuses objects before writing the rows that reference them (baseline
 * import, approving a legacy snapshot); a capture is covered by its build's status instead.
 */
export async function withContentClaim<T>(
  storage: StorageAdapter,
  projectId: string,
  work: () => Promise<T>,
): Promise<T> {
  const path = `${contentDir(projectId)}/${CLAIMS_DIR}/${ulid()}.json`;
  await storage.write(path, Buffer.from(JSON.stringify({ at: Date.now() })));
  try {
    return await work();
  } finally {
    await storage.delete(path).catch(() => false);
  }
}
