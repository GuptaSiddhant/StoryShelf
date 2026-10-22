/**
 * A claimer process for the two-process queue test: opens the SQLite file given as argv[2] (its
 * schema already set up by the parent), waits for "go", then claims and acks jobs until the queue
 * is empty, and reports every build id it claimed. Exits when the parent disconnects.
 */
import { createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import { createSqliteDatabase } from "../index.ts";

const path = process.argv[2];
const owner = process.argv[3];
if (path === undefined || owner === undefined) {
  throw new Error("usage: queue-claimer-child <sqlite-file> <owner>");
}

const db = createSqliteDatabase(path);
const queue = createDatabaseCaptureQueue(db, { owner, leaseMs: 60_000 });

async function drain(): Promise<string[]> {
  const claimed: string[] = [];
  /* oxlint-disable eslint/no-await-in-loop -- claim, ack, repeat: sequential by design */
  for (let job = await queue.poll(); job !== null; job = await queue.poll()) {
    claimed.push(job.buildId);
    await queue.ack(job);
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return claimed;
}

process.on("disconnect", () => process.exit(0));
process.on("message", (message) => {
  if (message !== "go") {
    return;
  }
  drain().then(
    (claimed) => process.send?.({ owner, claimed }),
    (error: unknown) => process.send?.({ owner, error: String(error) }),
  );
});
process.send?.({ owner, ready: true });
