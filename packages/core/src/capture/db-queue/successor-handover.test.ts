import { describe, expect, it } from "vitest";
import type { DatabaseAdapter, TxStore } from "../../adapters/database.ts";
import { BuildModel } from "../../models/build.ts";
import { CaptureJobModel } from "../../models/capture-job.ts";
import type { CaptureJobRow } from "../../schema/capture-job.ts";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { claimNext } from "./claim.ts";
import { enqueueKeyed, finishJob } from "./single-flight.ts";
import type { QueueRuntime } from "./types.ts";
import { createWakeSignal } from "./wake.ts";

const iso = (ms: number): string => new Date(ms).toISOString();
const NOW = Date.parse("2026-01-01T00:00:00.000Z");
const KEY = "capture:b1";

/** Run transactions one after another, as SQLite's single writer does (the fake has no lock). */
function serialized(db: DatabaseAdapter): void {
  const { transact } = db;
  if (transact === undefined) return;
  let tail: Promise<unknown> = Promise.resolve();
  db.transact = async <R>(fn: (tx: TxStore) => Promise<R>): Promise<R> => {
    const run = tail.then(async () => await transact.call(db, fn));
    tail = run.catch(() => {});
    return (await run) as R;
  };
}

function runtimeOver(db: DatabaseAdapter): QueueRuntime {
  return {
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
}

/** A running single-flight job holding {@link KEY}, optionally with a request waiting on it. */
async function runningJob(options: { request: boolean; transactions?: boolean }) {
  const { db } = makeDatabase();
  serialized(db);
  if (options.transactions === false) delete db.transact;
  const rt = runtimeOver(db);
  await rt.model.createKeyed(
    {
      id: "j1",
      kind: "capture",
      buildId: "b1",
      shardId: null,
      maxAttempts: 2,
      payload: '{"x":1}',
      activeKey: KEY,
    },
    iso(NOW),
  );
  await claimNext(rt);
  if (options.request) await rt.model.requestRerun("j1", iso(NOW));
  const row = (await rt.model.get("j1")) as CaptureJobRow;
  return { db, rt, row };
}

const others = async (rt: QueueRuntime): Promise<CaptureJobRow[]> =>
  (await rt.model.listRecent(["capture"], 10)).filter((job) => job.jobId !== "j1");

describe("a single-flight job ends and hands its key over in one transaction", () => {
  it("queues exactly one successor with the same key and payload, and takes the marker", async () => {
    const { rt, row } = await runningJob({ request: true });

    await finishJob(rt, row, "done");

    const [successor, ...rest] = await others(rt);
    expect(rest).toEqual([]);
    expect(successor).toMatchObject({ status: "queued", activeKey: KEY, payload: '{"x":1}' });
    expect(await rt.model.get("j1")).toMatchObject({
      status: "done",
      activeKey: null,
      rerunRequestedAt: null,
    });
    expect((await rt.model.holderOf(KEY))?.jobId).toBe(successor?.jobId);
  });

  it("queues nothing when no request arrived", async () => {
    const { rt, row } = await runningJob({ request: false });
    await finishJob(rt, row, "done");
    expect(await others(rt)).toEqual([]);
    expect(await rt.model.holderOf(KEY)).toBeNull();
  });

  it("queues one successor when two settlers end the job together", async () => {
    const { rt, row } = await runningJob({ request: true });

    await Promise.all([finishJob(rt, row, "failed", "boom"), finishJob(rt, row, "failed", "boom")]);

    expect(await others(rt)).toHaveLength(1);
  });

  it("gives a cancelled job no successor, and keeps its marker", async () => {
    const { rt } = await runningJob({ request: true });

    const ended = await rt.model.endJob("j1", { status: "cancelled" }, iso(NOW));

    expect(ended).toEqual({ applied: true, successor: null });
    expect(await others(rt)).toEqual([]);
  });

  it("rolls the end back when the successor cannot be inserted, so the request is not lost", async () => {
    const { db, rt, row } = await runningJob({ request: true });
    const { transact } = db;
    db.transact = async <R>(fn: (tx: TxStore) => Promise<R>): Promise<R> =>
      (await (transact as NonNullable<typeof transact>).call(db, async (tx: TxStore) => {
        return await fn({
          ...tx,
          insert: async (table, values) => {
            if ((values as Partial<CaptureJobRow>).activeKey === KEY) throw new Error("disk full");
            return await tx.insert(table, values);
          },
        });
      })) as R;

    await expect(finishJob(rt, row, "done")).rejects.toThrow("disk full");

    expect(await rt.model.get("j1")).toMatchObject({ status: "running", activeKey: KEY });
    expect((await rt.model.get("j1"))?.rerunRequestedAt).toBeTruthy();
    expect(await others(rt)).toEqual([]);
  });

  it("leaves a job that already ended as it is when only open jobs may end", async () => {
    const { rt } = await runningJob({ request: true });
    await rt.model.endJob("j1", { status: "done" }, iso(NOW));

    const again = await rt.model.endJob("j1", { status: "failed", onlyOpen: true }, iso(NOW));

    expect(again).toEqual({ applied: false, successor: null });
    expect((await rt.model.get("j1"))?.status).toBe("done");
  });

  it("falls back to ending the job and starting the successor in two steps without transactions", async () => {
    const { rt, row } = await runningJob({ request: true, transactions: false });

    expect(await rt.model.endJob("j1", { status: "done" }, iso(NOW))).toBeNull();
    await finishJob(rt, row, "done");

    expect(await others(rt)).toHaveLength(1);
  });
});

describe("a request for the key of a job whose lease ran out", () => {
  it("marks the exhausting job, which hands over when it ends", async () => {
    const { rt } = await runningJob({ request: false });
    expect(await rt.model.markExhausting("j1", 3, "lease expired", iso(NOW))).toBe(true);

    const covering = await enqueueKeyed(rt, { kind: "capture", buildId: "b1", activeKey: KEY });

    expect(covering).toBe("j1");
    expect((await rt.model.get("j1"))?.rerunRequestedAt).toBeTruthy();
    const ended = await rt.model.endJob(
      "j1",
      { status: "failed", error: "lease expired", onlyOpen: true },
      iso(NOW),
    );
    expect(ended?.successor).toMatchObject({ activeKey: KEY, status: "queued" });
  });
});
