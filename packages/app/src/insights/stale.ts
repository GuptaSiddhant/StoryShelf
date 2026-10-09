import { InsightModel } from "@storyshelf/core/models";
/** Lazy interruption check: a run stuck past the stale window is failed on read. */
import { STALE_RUN_MS } from "@storyshelf/core/retention";
import type { InsightRow } from "@storyshelf/core/schema";
import type { InsightDeps } from "./deps.ts";

/** Return the row, first marking it `interrupted` when it is stale and still in flight. */
export async function freshen(deps: InsightDeps, row: InsightRow): Promise<InsightRow> {
  const inFlight = row.status === "pending" || row.status === "running";
  if (!inFlight || Date.now() - Date.parse(row.createdAt) < STALE_RUN_MS) {
    return row;
  }
  await new InsightModel(deps.db).markFailed(row.id, "interrupted");
  return { ...row, status: "failed", errorCode: "interrupted" };
}
