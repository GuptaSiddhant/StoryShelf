/**
 * Git-state delivery from the forked capture child (ADR 0014): the child only enqueues a `notify`
 * job on the database queue; the parent's consumer, a separate queue handle on the same database,
 * claims and delivers it. Nothing travels over IPC, and with no consumer the job waits.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createShelfLogger } from "../../logger.ts";
import { createNotifyHandler } from "../build-state/notify-job.ts";
import { world, type World } from "../build-state/test-world.ts";
import type { BuildStatePublisher } from "../build-state/types.ts";
import { createCaptureConsumer } from "../consumer/index.ts";
import { createDatabaseCaptureQueue } from "../db-queue/index.ts";

const seen = vi.hoisted(() => ({ buildStates: [] as unknown[] }));
vi.mock("../dispatch.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dispatch.ts")>();
  return {
    ...actual,
    createDispatchJob: (deps: { buildState: unknown }) => {
      seen.buildStates.push(deps.buildState);
      return vi.fn(async () => {});
    },
  };
});

const { runCaptureChild } = await import("./child.ts");

const silent = createShelfLogger({ level: "silent" });
const cadence = { idleMs: 20, activeMs: 10, activeWindowMs: 1000, jitter: 0 };

/** A child process whose publisher (the one the child built for its handler) the test can call. */
async function startChild(w: World) {
  seen.buildStates.length = 0; // only the publisher this child builds, not an earlier test's
  // oxlint-disable-next-line unicorn/prefer-event-target -- stands in for Node's process emitter
  const events = new EventEmitter();
  const sent: unknown[] = [];
  const done = runCaptureChild(
    {
      db: w.db,
      storage: w.storage,
      runner: { cancel: vi.fn(async () => {}), render: vi.fn() } as never,
      scratchDir: ".tmp/child-notify-test",
      notifiers: [w.git.provider],
      secret: w.deps.secret,
      config: {},
      publicOrigin: async () => "https://shelf.example.com",
      logger: silent,
    },
    {
      send: (message) => sent.push(message),
      on: (event, listener) => events.on(event, listener),
      env: {},
      exit: vi.fn(),
    },
  );
  await vi.waitFor(() => {
    expect(seen.buildStates.length).toBeGreaterThan(0);
  });
  const buildState = seen.buildStates.at(-1) as BuildStatePublisher;
  return {
    buildState,
    sent,
    stop: async (): Promise<void> => {
      events.emit("SIGTERM");
      await done;
    },
  };
}

/** The `notify` rows on the database, whatever handle wrote them. */
async function notifyJobs(w: World): Promise<{ status: string; buildId: string | null }[]> {
  const rows = (await w.db.list(w.db.tables.captureJobs)) as unknown as {
    kind: string;
    entry: string;
    status: string;
    buildId: string | null;
  }[];
  return rows
    .filter((row) => row.kind === "notify" && row.entry === "job")
    .map((row) => ({ status: row.status, buildId: row.buildId }));
}

describe("forked capture child: git-state delivery through the durable queue", () => {
  it("leaves a durable job before any consumer runs, then a separate consumer delivers it without an IPC wake", async () => {
    const w = await world();
    const child = await startChild(w);

    await child.buildState.request(w.build.id);

    // Durable and undelivered: the child wrote a row, and nobody has claimed it yet.
    expect(await notifyJobs(w)).toEqual([{ status: "queued", buildId: w.build.id }]);
    expect(w.git.calls).toEqual([]);

    // The parent's consumer: its own queue handle on the same database.
    const consumer = createCaptureConsumer({
      queue: createDatabaseCaptureQueue(w.db, { kinds: ["notify"], owner: "parent" }),
      cadence,
      logger: silent,
      config: { concurrency: 1 },
      handlers: { notify: createNotifyHandler({ deps: w.deps }) },
    });
    const started = consumer.start();
    await vi.waitFor(
      async () => {
        expect(w.git.calls.length).toBeGreaterThan(0);
        expect((await notifyJobs(w)).map((row) => row.status)).toEqual(["done"]);
      },
      { timeout: 5000 },
    );
    await consumer.stop();
    await started;
    await child.stop();

    // Delivered by polling alone: the child sent the parent nothing.
    expect(child.sent).toEqual([]);
  });

  it("keeps the job queued when no consumer is configured: neither dropped nor delivered inline", async () => {
    const w = await world();
    const child = await startChild(w);

    await child.buildState.request(w.build.id);
    await child.buildState.request(w.build.id); // coalesced into the waiting job
    await new Promise((resolve) => setTimeout(resolve, 100));
    await child.stop();

    expect(await notifyJobs(w)).toEqual([{ status: "queued", buildId: w.build.id }]);
    expect(w.git.calls).toEqual([]);
  });
});
