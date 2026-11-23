// oxlint-disable max-statements curly no-console
// The PUBLISHED previous release's job consumers (installed from npm into a scratch directory,
// never from this checkout), run for a while against a database the pull request's code migrated
// and enqueued onto: the mixed-queue test of ADR 0053, decision 8.
//
// The queues and consumers are the release's own (`createDatabaseCaptureQueue`,
// `createCaptureConsumer`), polling the kinds its app polls on a long-running host with `testing`:
// `capture` + `publish` on the main queue, `notify` + `review-request` on the notify queue. The
// `notify` handler is the release's own declaration (its payload version and `accepts`); only `run`
// is replaced, by a recorder, so nothing is delivered. The other kinds declare nothing in that
// release, which is what the stubs declare. At start it logs one `declared` line per kind: the
// highest payload version its handler reads (default 1). The current side compares against that,
// never against a version typed into the test.
//
// Usage (from the scratch directory): node mixed-queue-previous.mjs <sqlite|postgres> <seconds> <log>
// Env: DATABASE_URL (postgres) or DATA_DIR (sqlite).
import {
  createCaptureConsumer,
  createDatabaseCaptureQueue,
  createNotifyHandler,
} from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const [dialect, seconds, log] = process.argv.slice(2);
const dataDir = process.env["DATA_DIR"] ?? ".data";
const RELEASE = "previous";

async function openDatabase() {
  if (dialect === "sqlite") {
    const { createSqliteDatabase } = await import("@storyshelf/db-sqlite");
    return createSqliteDatabase(`${dataDir}/shelf.db`);
  }
  if (dialect === "postgres") {
    const { createPostgresDatabase } = await import("@storyshelf/db-postgres");
    return createPostgresDatabase({ url: process.env["DATABASE_URL"] });
  }
  throw new Error(`unknown dialect: ${dialect}`);
}

function record(event, job) {
  const line = { release: RELEASE, event, kind: job.kind, jobId: job.jobId, v: job.payloadVersion };
  appendFileSync(log, `${JSON.stringify(line)}\n`);
}

const ran = async (job) => {
  record("ran", job);
  await Promise.resolve();
};

function recordingQueue(database, kinds, retries) {
  const queue = createDatabaseCaptureQueue(database, { kinds, retries });
  const handBack = queue.handBack;
  queue.handBack = async (job, options) => {
    record("handed-back", job);
    await handBack(job, options);
  };
  return queue;
}

const logger = createShelfLogger({ level: "warn" });
const database = await openDatabase();
// Skips its migrations: the schema is a newer release's (ADR 0053, decision 2).
await database.lifecycle?.setup?.({ config: {}, logger });
const notify = { ...createNotifyHandler({ deps: {} }), run: ran };
const handlers = {
  capture: { run: ran },
  publish: { run: ran },
  notify,
  "review-request": { run: ran },
};
for (const [kind, handler] of Object.entries(handlers)) {
  const declared = handler.payloadVersion ?? 1;
  appendFileSync(
    log,
    `${JSON.stringify({ release: RELEASE, event: "declared", kind, declared })}\n`,
  );
}
const consumers = [
  createCaptureConsumer({
    queue: recordingQueue(database, ["capture", "publish"], 2),
    handlers: { capture: handlers.capture, publish: handlers.publish },
    config: { concurrency: 2 },
    logger,
  }),
  createCaptureConsumer({
    queue: recordingQueue(database, ["notify", "review-request"], 4),
    handlers: { notify: handlers.notify, "review-request": handlers["review-request"] },
    config: { concurrency: 2 },
    logger,
  }),
];
const running = consumers.map(async (consumer) => await consumer.start());
await delay(Number(seconds) * 1000);
await Promise.all(consumers.map(async (consumer) => await consumer.stop()));
await Promise.all(running);
await database.lifecycle?.teardown?.();
console.log(`previous release consumed for ${seconds}s (${dialect})`);
