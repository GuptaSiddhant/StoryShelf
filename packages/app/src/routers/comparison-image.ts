import {
  isComparisonImagePath,
  parseComparisonReference,
  type ComparisonReference,
} from "@storyshelf/core/capture";
import type { Snapshot } from "@storyshelf/core/schema";
import { createHash } from "node:crypto";
import { getStore } from "../store.ts";

/** Validate provenance and ownership before reading a frozen reference. */
export function validFrozenReference(
  snapshot: Snapshot,
  projectId: string,
  buildId: string,
): { reference: ComparisonReference; path: string } | null {
  const reference = parseComparisonReference(snapshot.comparisonMetadata);
  const path = snapshot.comparisonImagePath;
  if (
    !reference ||
    !path ||
    !isComparisonImagePath(path, projectId, buildId) ||
    reference.baselineId !== snapshot.baselineId ||
    reference.baselineVersion !== snapshot.baselineVersion
  )
    return null;
  return { reference, path };
}

/** A comparison is usable only when its bytes match the capture-time record. */
export async function readComparisonImage(path: string, sha256: string): Promise<Buffer | null> {
  try {
    const image = await getStore().storage.read(path);
    return createHash("sha256").update(image).digest("hex") === sha256 ? image : null;
  } catch {
    return null;
  }
}
