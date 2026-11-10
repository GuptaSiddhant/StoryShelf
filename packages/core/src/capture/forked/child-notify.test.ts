/**
 * Git-state delivery from the forked capture child (ADR 0014): the child only enqueues a `notify`
 * job on the database queue; the parent's consumer, a separate queue handle on the same database,
 * claims and delivers it. Nothing travels over IPC, and with no consumer the job waits.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vite-plus/test";
import { createShelfLogger } from "../../logger.ts";
import { createNotifyHandler } from "../build-state/notify-job.ts";
import { world, type World } from "../build-state/test-world.ts";
import type { BuildStatePublisher } from "../build-state/types.ts";
import { createCaptureConsumer } from "../consumer/index.ts";
import { createDatabaseCaptureQueue } from "../db-queue/index.ts";

// The capture itself is stubbed: a pushed job only asks the publisher the child built to show the
// build's state, as a real capture does when its status changes.
vi.mock("../dispatch.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dispatch.ts")>();
  return {
    ...actual,
    createDispatchJob:
      (deps: { buildState: BuildStatePublisher }) => async (job: { buildId: string }) => {
        await deps.buildState.request(job.buildId);
      },
  };
});

const { runCaptureChild } = await import("./child.ts");

const silent = createShelfLogger({ level: "silent" });
const cadence = { idleMs: 20, activeMs: 10, activeWindowMs: 1000, jitter: 0 };

/** A child process that runs a pushed job to its end, like the parent's `run` message does. */
function startChild(w: World) {
  // oxlint-disable-next-line unicorn/prefer-event-target -- stands in for Node's process emitter
  const events = new EventEmitter();
  const sent: unknown[] = [];
  let runs = 0;
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
  return {
    sent,
    /** Push a job and wait until the child reports it done. */
    run: async (buildId: string): Promise<void> => {
      // The child starts listening once its image engine has loaded.
      await vi.waitFor(() => {
        expect(events.listenerCount("message")).toBeGreaterThan(0);
      });
      runs += 1;
      const runId = `run-${String(runs)}`;
      events.emit("message", {
        type: "run",
        runId,
        job: { buildId, receipt: `${buildId}:1` },
      });
      await vi.waitFor(() => {
        expect(sent).toContainEqual(expect.objectContaining({ type: "done", runId }));
      });
    },
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
    const child = startChild(w);

    await child.run(w.build.id);

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

    // Delivered by polling alone: the child's only message was the job's result, no wake-up.
    expect(child.sent.map((message) => (message as { type: string }).type)).toEqual(["done"]);
  });

  it("hands a job to a consumer that is already polling, found at a later poll and not by a wake-up", async () => {
    const w = await world();
    const queue = createDatabaseCaptureQueue(w.db, { kinds: ["notify"], owner: "parent" });
    const poll = queue.poll.bind(queue);
    let polls = 0;
    queue.poll = async (options) => {
      polls += 1;
      return await poll(options);
    };
    const consumer = createCaptureConsumer({
      queue,
      cadence,
      logger: silent,
      config: { concurrency: 1 },
      handlers: { notify: createNotifyHandler({ deps: w.deps }) },
    });
    const started = consumer.start();
    // The consumer's polls come up empty first; the child's enqueue is in a different queue handle.
    await vi.waitFor(() => {
      expect(polls).toBeGreaterThanOrEqual(2);
    });
    expect(w.git.calls).toEqual([]);
    const child = startChild(w);

    await child.run(w.build.id);

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
    expect(child.sent.map((message) => (message as { type: string }).type)).toEqual(["done"]);
  });

  it("keeps the job queued when no consumer is configured: neither dropped nor delivered inline", async () => {
    const w = await world();
    const child = startChild(w);

    await child.run(w.build.id);
    await child.run(w.build.id); // coalesced into the waiting job
    await child.stop();

    expect(await notifyJobs(w)).toEqual([{ status: "queued", buildId: w.build.id }]);
    expect(w.git.calls).toEqual([]);
  });
});
