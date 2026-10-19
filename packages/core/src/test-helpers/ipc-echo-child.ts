/**
 * A minimal capture child for the real-fork tests: polls the parent over process IPC and settles jobs
 * by build id. `crash*` exits non-zero, `fail*` nacks without requeue, `hang*` goes silent forever,
 * `slow*` takes ~400 ms while reporting progress, `fan*` hands two shards of its build back to the
 * parent before acking (a sharded plan), anything else is acked.
 */
import { IpcCaptureQueue } from "../capture/forked/ipc-queue.ts";

const queue = new IpcCaptureQueue({
  send: (message) => {
    process.send?.(message);
  },
  onMessage: (listener) => {
    process.on("message", listener);
  },
  onDisconnect: (listener) => {
    process.on("disconnect", listener);
  },
});

process.on("disconnect", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

/* oxlint-disable eslint/no-await-in-loop -- one job at a time is the point of this helper */
for (;;) {
  const job = await queue.poll({ waitMs: 200 });
  if (!job) {
    continue;
  }
  if (job.buildId.startsWith("hang")) {
    // Alive but silent: no progress, no ack. Only the parent's lease can end this.
    await new Promise(() => {});
  }
  if (job.buildId.startsWith("slow")) {
    // Long but healthy: keeps reporting progress, then acks.
    for (let step = 0; step < 8; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      queue.reportProgress(job);
    }
  }
  if (job.buildId.startsWith("crash")) {
    // A crash is the point of this helper.
    // oxlint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  }
  if (job.buildId.startsWith("fan") && !job.shard) {
    for (const shard of [`${job.buildId}:render:1`, `${job.buildId}:render:2`]) {
      await queue.enqueue({ buildId: job.buildId, shard });
    }
  }
  await (job.buildId.startsWith("fail") ? queue.nack(job, { requeue: false }) : queue.ack(job));
}
