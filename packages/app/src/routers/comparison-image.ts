import { createHash } from "node:crypto";
import { getStore } from "../store.ts";

/** A comparison is usable only when its bytes match the capture-time record. */
export async function readComparisonImage(path: string, sha256: string): Promise<Buffer | null> {
  try {
    const image = await getStore().storage.read(path);
    return createHash("sha256").update(image).digest("hex") === sha256 ? image : null;
  } catch {
    return null;
  }
}
