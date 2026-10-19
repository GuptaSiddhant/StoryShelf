/**
 * A minimal capture child for the real-fork tests: polls the parent over process IPC and settles jobs
 * by build id. `crash*` exits non-zero, `fail*` nacks without requeue, anything else is acked.
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

for (;;) {
  // oxlint-disable-next-line eslint/no-await-in-loop -- one job at a time is the point of this helper
  const job = await queue.poll({ waitMs: 200 });
  if (!job) {
    continue;
  }
  if (job.buildId.startsWith("crash")) {
    // A crash is the point of this helper.
    // oxlint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  }
  // oxlint-disable-next-line eslint/no-await-in-loop -- see above
  await (job.buildId.startsWith("fail") ? queue.nack(job, { requeue: false }) : queue.ack(job));
}
