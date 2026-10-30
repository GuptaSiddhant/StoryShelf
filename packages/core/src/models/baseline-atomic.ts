/** Transactional baseline mutation for adapters with explicit reference lifecycle support. */
import { and, eq } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import { DEFAULT_BROWSER } from "../adapters/capture-runner.ts";
import type { BuildReferenceLifecycle, TxStore } from "../adapters/database.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import { col } from "./columns.ts";

export interface AtomicBaselineInput {
  id: string;
  existingId: string | null;
  existingVersion: string | null;
  projectId: string;
  storyId: string;
  viewport: string;
  branch: string;
  browser: string;
  snapshotId: string;
  sourceBuildId: string | null;
  originalPath: string;
  screenshotPath: string;
  infraHash: string | null | undefined;
  fingerprint: string | null | undefined;
  mode: string | null | undefined;
}

/** Atomically change the baseline row and its complete build-reference set. */
export async function upsertAtomicBaseline(
  lifecycle: BuildReferenceLifecycle,
  tables: { baselines: Table; snapshots: Table },
  input: AtomicBaselineInput,
): Promise<Baseline> {
  return await lifecycle.replaceReferences(
    { projectId: input.projectId, type: "baseline", id: input.id },
    input.sourceBuildId ? [input.sourceBuildId] : [],
    async (tx) => await writeBaseline(tx, tables, input),
  );
}

async function writeBaseline(
  tx: TxStore,
  tables: { baselines: Table; snapshots: Table },
  input: AtomicBaselineInput,
): Promise<Baseline> {
  const rows = (await tx.list(tables.baselines, {
    where: and(
      eq(col(tables.baselines, "projectId"), input.projectId),
      eq(col(tables.baselines, "storyId"), input.storyId),
      eq(col(tables.baselines, "viewportName"), input.viewport),
      eq(col(tables.baselines, "branch"), input.branch),
      eq(col(tables.baselines, "browser"), input.browser),
    ),
    limit: 1,
  })) as unknown as Baseline[];
  const existing = rows[0] ?? null;
  if (
    (existing?.id ?? null) !== input.existingId ||
    (existing?.updatedAt ?? null) !== input.existingVersion
  )
    throw new Error("Baseline changed during promotion; retry");
  if (input.sourceBuildId) await assertSource(tx, tables.snapshots, input);
  const now = new Date().toISOString();
  const fields = {
    snapshotId: input.snapshotId,
    sourceBuildId: input.sourceBuildId,
    screenshotPath: input.screenshotPath,
    infraHash: input.infraHash ?? existing?.infraHash ?? null,
    fingerprint: input.fingerprint ?? existing?.fingerprint ?? null,
    mode: input.mode ?? existing?.mode ?? null,
    updatedAt: now,
  };
  return (existing
    ? await tx.update(tables.baselines, existing.id, fields)
    : await tx.insert(tables.baselines, {
        ...fields,
        id: input.id,
        projectId: input.projectId,
        storyId: input.storyId,
        viewportName: input.viewport,
        branch: input.branch,
        browser: input.browser,
        createdAt: now,
      })) as unknown as Baseline;
}

async function assertSource(tx: TxStore, table: Table, input: AtomicBaselineInput): Promise<void> {
  const row = (await tx.get(table, input.snapshotId)) as unknown as Snapshot | null;
  const origin = row?.inherited ? row.sourceBuildId : row?.buildId;
  if (
    !row ||
    row.projectId !== input.projectId ||
    row.storyId !== input.storyId ||
    row.viewportName !== input.viewport ||
    (row.browser ?? DEFAULT_BROWSER) !== input.browser ||
    row.screenshotPath !== input.originalPath ||
    origin !== input.sourceBuildId
  ) {
    throw new Error("Source snapshot changed during promotion; retry");
  }
}
