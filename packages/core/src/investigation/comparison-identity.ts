/** A stable identity for the exact comparison an investigation was requested for. */
import { createHash } from "node:crypto";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface InvestigationComparison {
  projectId: string;
  snapshotId: string;
  currentSourceBuildId: string;
  baselineId: string;
  baselineVersion: string;
  baselineSourceBuildId: string;
  baselineSourceSnapshotId: string | null;
  referenceImageSha256: string;
  mode: JsonValue;
  target: string;
  captureSettings: JsonValue;
  evidenceFormatVersion: number;
}

/** Canonicalize object keys without changing array order. Missing fields are not silently guessed. */
function canonical(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid JSON number");
  if (value === undefined) throw new Error("Invalid comparison identity");
  return JSON.stringify(value);
}

/** Requested identity only: replay fingerprints and results are deliberately not part of this key. */
export function investigationComparisonKey(comparison: InvestigationComparison): string {
  if (!/^[a-f0-9]{64}$/u.test(comparison.referenceImageSha256)) {
    throw new Error("Invalid reference image digest");
  }
  if (
    !Number.isSafeInteger(comparison.evidenceFormatVersion) ||
    comparison.evidenceFormatVersion < 1
  ) {
    throw new Error("Invalid evidence format version");
  }
  for (const field of [
    comparison.projectId,
    comparison.snapshotId,
    comparison.currentSourceBuildId,
    comparison.baselineId,
    comparison.baselineVersion,
    comparison.baselineSourceBuildId,
    comparison.target,
  ]) {
    if (typeof field !== "string" || field.length === 0)
      throw new Error("Incomplete comparison identity");
  }
  const identity: JsonValue = {
    version: 1,
    projectId: comparison.projectId,
    snapshotId: comparison.snapshotId,
    currentSourceBuildId: comparison.currentSourceBuildId,
    baselineId: comparison.baselineId,
    baselineVersion: comparison.baselineVersion,
    baselineSourceBuildId: comparison.baselineSourceBuildId,
    baselineSourceSnapshotId: comparison.baselineSourceSnapshotId,
    referenceImageSha256: comparison.referenceImageSha256,
    mode: comparison.mode,
    target: comparison.target,
    captureSettings: comparison.captureSettings,
    evidenceFormatVersion: comparison.evidenceFormatVersion,
  };
  return createHash("sha256").update(canonical(identity)).digest("hex");
}
