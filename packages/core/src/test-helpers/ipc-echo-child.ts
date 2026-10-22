/**
 * A minimal capture child for the real-fork tests: answers the jobs the parent pushes over process
 * IPC, by build id. `crash*` exits non-zero, `fail*` reports a failure, `hang*` goes silent forever,
 * `slow*` takes ~400 ms while reporting progress, anything else is done at once.
 */
import type { ChildMessage, ParentMessage } from "../capture/forked/protocol.ts";

const send = (message: ChildMessage): void => {
  process.send?.(message);
};

process.on("disconnect", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

async function handle(message: ParentMessage): Promise<void> {
  if (message.type !== "run") {
    return;
  }
  const { runId, job } = message;
  if (job.buildId.startsWith("hang")) {
    // Alive but silent: no progress, no answer. Only the parent's lease can end this.
    await new Promise(() => {});
  }
  if (job.buildId.startsWith("slow")) {
    // Long but healthy: keeps reporting progress, then finishes.
    for (let step = 0; step < 8; step += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- paced progress is the point
      await new Promise((resolve) => setTimeout(resolve, 50));
      send({ type: "progress", runId });
    }
  }
  if (job.buildId.startsWith("crash")) {
    // A crash is the point of this helper.
    // oxlint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  }
  send(
    job.buildId.startsWith("fail")
      ? { type: "failed", runId, error: `${job.buildId} failed` }
      : { type: "done", runId },
  );
}

process.on("message", (message: ParentMessage) => {
  handle(message).catch(() => {});
});
