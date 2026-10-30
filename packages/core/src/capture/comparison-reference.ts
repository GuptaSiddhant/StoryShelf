/** Freeze a baseline image under the consuming build so it survives baseline movement. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { DEFAULT_BROWSER } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import type { Baseline } from "../schema/baseline.ts";
import { ulid } from "../utils/ulid.ts";

const referenceSchema = z.object({
  version: z.literal(1),
  baselineId: z.string(),
  baselineVersion: z.string(),
  branch: z.string(),
  defaultBranch: z.boolean(),
  sourceBuildId: z.string().nullable(),
  sourceSnapshotId: z.string().nullable(),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  baselineFingerprint: z.string().nullable(),
  captureFingerprint: z.string().nullable(),
  mode: z.string().nullable(),
  target: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
export type ComparisonReference = z.infer<typeof referenceSchema>;
export interface ComparisonSettings {
  defaultBranch: string;
  mode: string | null;
  target: string;
  width: number | null;
  height: number | null;
  captureFingerprint: string | null;
  sourceSnapshotId: string | null;
}

export async function freezeComparison(
  storage: StorageAdapter,
  projectId: string,
  buildId: string,
  baseline: Baseline,
  settings: ComparisonSettings,
): Promise<{ comparisonImagePath: string; comparisonMetadata: string }> {
  const image = await storage.read(baseline.screenshotPath);
  const comparisonImagePath = `${projectId}/builds/${buildId}/comparisons/${ulid()}.png`;
  const reference: ComparisonReference = {
    version: 1,
    baselineId: baseline.id,
    baselineVersion: baseline.updatedAt,
    branch: baseline.branch,
    defaultBranch: baseline.branch === settings.defaultBranch,
    sourceBuildId: baseline.sourceBuildId ?? null,
    sourceSnapshotId: settings.sourceSnapshotId,
    imageSha256: createHash("sha256").update(image).digest("hex"),
    baselineFingerprint: baseline.fingerprint,
    captureFingerprint: settings.captureFingerprint,
    mode: settings.mode,
    target: settings.target,
    width: settings.width,
    height: settings.height,
  };
  await storage.write(comparisonImagePath, image);
  return { comparisonImagePath, comparisonMetadata: JSON.stringify(reference) };
}

export function parseComparisonReference(
  raw: string | null | undefined,
): ComparisonReference | null {
  if (!raw) return null;
  try {
    const parsed = referenceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Reject paths outside the consuming build's dedicated comparison directory. */
export function isComparisonImagePath(path: string, projectId: string, buildId: string): boolean {
  const prefix = `${projectId}/builds/${buildId}/comparisons/`;
  return (
    path.startsWith(prefix) && /^[0-9A-HJKMNP-TV-Z]{26}\.png$/u.test(path.slice(prefix.length))
  );
}

/** Identify a rendering snapshot only when its stored identity and image are provable. */
export async function sourceSnapshotId(
  db: DatabaseAdapter,
  baseline: Baseline,
): Promise<string | null> {
  if (!baseline.sourceBuildId || !baseline.snapshotId) return null;
  const snapshot = await new SnapshotModel(db).get(baseline.snapshotId);
  if (
    !snapshot ||
    snapshot.inherited ||
    snapshot.buildId !== baseline.sourceBuildId ||
    snapshot.projectId !== baseline.projectId ||
    snapshot.storyId !== baseline.storyId ||
    snapshot.viewportName !== baseline.viewportName ||
    (snapshot.browser ?? DEFAULT_BROWSER) !== (baseline.browser ?? DEFAULT_BROWSER) ||
    snapshot.screenshotPath !== baseline.screenshotPath
  )
    return null;
  return snapshot.id;
}
