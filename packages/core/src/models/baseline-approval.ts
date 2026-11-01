/** Review checks and decision persisted inside the baseline/reference transaction. */
import { and, eq } from "drizzle-orm";
import type { Tables, TxStore } from "../adapters/database.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import { BaselineWriteConflict } from "./baseline-conflict.ts";
import { baselineStatus, isBaselineDrifted, type BaselineStatus } from "./baseline-status.ts";
import { col } from "./columns.ts";

export interface AtomicBaselineApproval {
  snapshot: Snapshot;
  reviewedBy: string | null;
  force: boolean;
  branch: string;
}
export class BaselineApprovalConflict extends BaselineWriteConflict {
  readonly driftStatus?: BaselineStatus;
  constructor(message: string, driftStatus?: BaselineStatus) {
    super(message);
    this.driftStatus = driftStatus;
  }
}

export async function approveInTransaction(
  tx: TxStore,
  tables: Tables,
  input: AtomicBaselineApproval,
): Promise<void> {
  const snapshot = (await tx.get(
    tables.snapshots,
    input.snapshot.id,
  )) as unknown as Snapshot | null;
  if (
    !snapshot ||
    snapshot.projectId !== input.snapshot.projectId ||
    snapshot.buildId !== input.snapshot.buildId ||
    snapshot.status !== input.snapshot.status ||
    snapshot.updatedAt !== input.snapshot.updatedAt ||
    snapshot.screenshotPath !== input.snapshot.screenshotPath ||
    snapshot.baselineId !== input.snapshot.baselineId ||
    snapshot.baselineVersion !== input.snapshot.baselineVersion
  )
    throw new BaselineApprovalConflict("Snapshot changed during approval; reload and retry");
  const build = (await tx.get(tables.builds, snapshot.buildId)) as unknown as Build | null;
  const project = (await tx.get(tables.projects, snapshot.projectId)) as unknown as Project | null;
  if (
    !build ||
    !project ||
    build.projectId !== project.id ||
    build.status === "cancelled" ||
    build.gitBranch !== input.branch
  )
    throw new BaselineApprovalConflict("Build is unavailable for approval");
  const own = await baselineFor(tx, tables, snapshot, build.gitBranch);
  const current =
    own ??
    (build.gitBranch === project.gitDefaultBranch
      ? null
      : await baselineFor(tx, tables, snapshot, project.gitDefaultBranch));
  const status = baselineStatus(snapshot, current);
  if (
    (snapshot.status === "new" || snapshot.status === "changed") &&
    isBaselineDrifted(status) &&
    !input.force
  )
    throw new BaselineApprovalConflict("Baseline changed after this diff was computed", status);
  await tx.update(tables.snapshots, snapshot.id, {
    status: "approved",
    reviewedBy: input.reviewedBy,
    reviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function baselineFor(
  tx: TxStore,
  tables: Tables,
  snapshot: Snapshot,
  branch: string,
): Promise<Baseline | null> {
  const rows = await tx.list(tables.baselines, {
    where: and(
      eq(col(tables.baselines, "projectId"), snapshot.projectId),
      eq(col(tables.baselines, "storyId"), snapshot.storyId),
      eq(col(tables.baselines, "viewportName"), snapshot.viewportName),
      eq(col(tables.baselines, "browser"), snapshot.browser ?? "chromium"),
      eq(col(tables.baselines, "branch"), branch),
    ),
    limit: 1,
  });
  return (rows[0] as unknown as Baseline | undefined) ?? null;
}
