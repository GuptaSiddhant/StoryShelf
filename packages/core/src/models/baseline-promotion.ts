/** The fence of a capture-path baseline promotion: a `cancelled` or superseded build never moves one. */
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter, TxStore } from "../adapters/database.ts";
import type { Build } from "../schema/build.ts";
import { BaselinePromotionRefused } from "./baseline-promotion-refused.ts";

/** The build a capture run promotes baselines for, and the capture generation it started at. */
export interface CapturingBuild {
  id: string;
  generation?: number | undefined;
}

/** Refuse unless `build` is still live for this run. */
function assertLive(build: Build | null, spec: CapturingBuild): void {
  if (build === null || build.status === "cancelled") {
    throw new BaselinePromotionRefused(`build ${spec.id} is cancelled or gone`);
  }
  if (spec.generation !== undefined && (build.captureGeneration ?? 0) !== spec.generation) {
    throw new BaselinePromotionRefused(`build ${spec.id} was retried; this run is stale`);
  }
}

/** Check outside any transaction (adapters without the reference lifecycle). */
export async function assertBuildLive(db: DatabaseAdapter, spec: CapturingBuild): Promise<void> {
  assertLive((await db.get(db.tables.builds, spec.id)) as unknown as Build | null, spec);
}

/** Check inside the transaction of the write, so a cancel cannot slip in between. */
export async function assertBuildLiveInTx(
  tx: TxStore,
  builds: Table,
  spec: CapturingBuild,
): Promise<void> {
  assertLive((await tx.get(builds, spec.id)) as unknown as Build | null, spec);
}
