import { describe, expect, it } from "vitest";
import { BuildModel } from "../../models/build.ts";
import { CaptureJobModel } from "../../models/capture-job.ts";
import type { CaptureJobRow } from "../../schema/capture-job.ts";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { claimNext } from "./claim.ts";
import { startSuccessor } from "./single-flight.ts";
import type { QueueRuntime } from "./types.ts";
import { createWakeSignal } from "./wake.ts";

const iso = (ms: number): string => new Date(ms).toISOString();
const NOW = Date.parse("2026-01-01T00:00:00.000Z");

/** A single-flight job that failed while a request for its key was waiting: the row as a settler read it. */
async function failedWithRequest(): Promise<{ rt: QueueRuntime; row: CaptureJobRow }> {
  const { db } = makeDatabase();
  const rt: QueueRuntime = {
    model: new CaptureJobModel(db),
    builds: new BuildModel(db),
    kinds: ["capture"],
    leaseMs: 1000,
    maxAttempts: 2,
    owner: "me",
    now: () => NOW,
    wake: createWakeSignal(),
    pollVersion: 0,
  };
  await rt.model.createKeyed(
    {
      id: "j1",
      kind: "capture",
      buildId: "b1",
      shardId: null,
      maxAttempts: 2,
      payload: null,
      activeKey: "capture:b1",
    },
    iso(NOW),
  );
  await claimNext(rt);
  const row = await rt.model.get("j1");
  if (row === null) throw new Error("job vanished");
  await rt.model.requestRerun("j1", iso(NOW));
  await rt.model.finishJob("j1", "failed", iso(NOW), "lease expired");
  return { rt, row };
}

const successors = async (rt: QueueRuntime): Promise<CaptureJobRow[]> =>
  (await rt.model.listRecent(["capture"], 10)).filter((job) => job.jobId !== "j1");

describe("the successor of a failed single-flight job", () => {
  it("is started once when two settlers reach it together", async () => {
    const { rt, row } = await failedWithRequest();

    await Promise.all([startSuccessor(rt, row), startSuccessor(rt, row)]);

    expect(await successors(rt)).toHaveLength(1);
  });

  it("is not started again by a settler that arrives after the successor already ended", async () => {
    const { rt, row } = await failedWithRequest();
    await startSuccessor(rt, row);
    const first = await rt.model.holderOf("capture:b1");
    if (first === null) throw new Error("no successor");
    await rt.model.finishJob(first.jobId, "done", iso(NOW), null);

    await startSuccessor(rt, row);

    expect(await successors(rt)).toHaveLength(1);
  });
});
