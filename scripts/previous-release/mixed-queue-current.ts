import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createReviewRequestEnqueuer } from "../../packages/app/src/review-request-data.ts";
import type { DatabaseAdapter } from "../../packages/core/src/adapters/database.ts";
import {
  createNotifyEnqueuer,
  createNotifyHandler,
} from "../../packages/core/src/capture/build-state/notify-job.ts";
import { createCaptureConsumer } from "../../packages/core/src/capture/consumer/index.ts";
import type { ConsumerJob } from "../../packages/core/src/capture/consumer/types.ts";
import { createDatabaseCaptureQueue } from "../../packages/core/src/capture/db-queue/index.ts";
import type { DatabaseCaptureQueue } from "../../packages/core/src/capture/db-queue/types.ts";
import { createShelfLogger } from "../../packages/core/src/logger.ts";
import { CaptureJobModel } from "../../packages/core/src/models/capture-job.ts";
import type { CaptureJobKind, CaptureJobRow } from "../../packages/core/src/schema/capture-job.ts";
// oxlint-disable max-statements max-lines-per-function curly no-console
// The mixed-queue test of ADR 0053, decision 8, this checkout's side. Run from the repo root with
// `nub scripts/previous-release/mixed-queue-current.ts <phase>` on a database this checkout
// migrated; previous-release.sh runs the previous release's consumers (mixed-queue-previous.mjs)
// between and beside these phases. Phases:
//   enqueue <batch>  enqueue one job of every kind through this checkout's own enqueue paths,
//                    including a repository link's `notify` job at payload version 2;
//   rollback         after the previous release consumed alone: nothing failed, it ran every job
//                    it understands, and it handed back each newer payload unrun with no attempt spent;
//   consume          this checkout's consumers run until every job ended (the previous release's
//                    run beside them), then: every job is `done`, ran exactly once, and each newer
//                    payload ran here.
// Env: DIALECT (sqlite|postgres), RELEASE, WORK (job list and consumer logs), DATABASE_URL or DATA_DIR.

interface Enqueued {
  id: string;
  kind: CaptureJobKind;
  v: number;
}
interface Recorded {
  release: string;
  event: "ran" | "handed-back";
  kind: CaptureJobKind;
  jobId: string;
  v: number;
}

const dialect = process.env["DIALECT"];
const work = process.env["WORK"] ?? ".tmp/previous-release";
const dataDir = process.env["DATA_DIR"] ?? ".data";
const jobsFile = `${work}/mixed-jobs.json`;
/** Every kind the app enqueues; `satisfies` fails the typecheck when a kind is added and not here. */
const KINDS = {
  capture: true,
  publish: true,
  notify: true,
  "review-request": true,
} as const satisfies Record<CaptureJobKind, true>;
/** How long the consume phase waits: a handed-back job is invisible for 30 s. */
const CONSUME_TIMEOUT_MS = 120_000;

async function open(): Promise<DatabaseAdapter> {
  if (dialect === "sqlite") {
    const { createSqliteDatabase } = await import("../../packages/db-sqlite/src/index.ts");
    return createSqliteDatabase(`${dataDir}/shelf.db`);
  }
  if (dialect === "postgres") {
    const { createPostgresDatabase } = await import("../../packages/db-postgres/src/index.ts");
    return createPostgresDatabase({ url: process.env["DATABASE_URL"] });
  }
  throw new Error(`unknown DIALECT: ${dialect}`);
}

function fail(message: string): never {
  throw new Error(`mixed-queue test FAILED (${dialect}): ${message}`);
}

const readJson = <T>(file: string, fallback: T): T =>
  existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
const readLog = (release: string): Recorded[] =>
  existsSync(`${work}/${release}.jsonl`)
    ? readFileSync(`${work}/${release}.jsonl`, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Recorded)
    : [];

/** Both queues as the app builds them on a long-running host with `testing`. */
function queuesOf(database: DatabaseAdapter): {
  main: DatabaseCaptureQueue;
  notify: DatabaseCaptureQueue;
} {
  return {
    main: createDatabaseCaptureQueue(database, { kinds: ["capture", "publish"], retries: 2 }),
    notify: createDatabaseCaptureQueue(database, {
      kinds: ["notify", "review-request"],
      retries: 4,
    }),
  };
}

/** Record every job a queue writes, through the enqueue path the app's own code takes. */
function recordEnqueues(queue: DatabaseCaptureQueue, into: Enqueued[]): void {
  const enqueueJob = queue.enqueueJob;
  queue.enqueueJob = async (job): Promise<string> => {
    const id = await enqueueJob(job);
    into.push({ id, kind: job.kind, v: job.payloadVersion ?? 1 });
    return id;
  };
}

async function enqueue(database: DatabaseAdapter, batch: string): Promise<void> {
  const { main, notify } = queuesOf(database);
  const enqueued: Enqueued[] = [];
  recordEnqueues(main, enqueued);
  recordEnqueues(notify, enqueued);
  const buildId = (n: number): string => `MIXED${batch}BUILD${n}`;
  // A capture is queued by `enqueue`, which writes its row directly (it stamps the build first).
  await main.enqueue({ buildId: buildId(1) });
  const capture = await new CaptureJobModel(database).latestForBuild(buildId(1), ["capture"]);
  if (capture !== null) enqueued.push({ id: capture.id, kind: "capture", v: 1 });
  await main.enqueueJob({ kind: "publish", buildId: buildId(2) });
  const notifyEnqueuer = createNotifyEnqueuer({ db: database }, notify);
  await notifyEnqueuer({ channelId: `channel-${batch}`, buildId: buildId(3) });
  await notifyEnqueuer({ linkId: `link-${batch}`, buildId: buildId(4) });
  await createReviewRequestEnqueuer(
    { db: database },
    { get: () => notify },
  )({
    projectId: "project",
    eventId: `${buildId(5)}:1`,
    target: { kind: "channel", channelId: `channel-${batch}` },
  });
  const missing = Object.keys(KINDS).filter((kind) => !enqueued.some((job) => job.kind === kind));
  if (missing.length > 0) fail(`enqueued no ${missing.join(", ")} job`);
  if (!enqueued.some((job) => job.v > 1)) fail("enqueued no job at a newer payload version");
  writeFileSync(jobsFile, JSON.stringify([...readJson<Enqueued[]>(jobsFile, []), ...enqueued]));
  console.log(`batch ${batch}: ${enqueued.map((job) => `${job.kind}@v${job.v}`).join(", ")}`);
}

interface JobRow {
  job: Enqueued;
  row: CaptureJobRow;
}

async function rowsOf(database: DatabaseAdapter, jobs: Enqueued[]): Promise<JobRow[]> {
  const model = new CaptureJobModel(database);
  return await Promise.all(
    jobs.map(async (job) => {
      const row = await model.get(job.id);
      if (row === null) fail(`job ${job.id} (${job.kind}) is gone`);
      return { job, row };
    }),
  );
}

const ranBy = (log: Recorded[], id: string): number =>
  log.filter((entry) => entry.event === "ran" && entry.jobId === id).length;

async function checkRollback(database: DatabaseAdapter): Promise<void> {
  const previous = readLog("previous");
  for (const { job, row } of await rowsOf(database, readJson<Enqueued[]>(jobsFile, []))) {
    const name = `${job.kind}@v${job.v} ${job.id}`;
    if (job.v === 1) {
      if (row.status !== "done") fail(`${name} is ${row.status}, not done by the previous release`);
      if (ranBy(previous, job.id) !== 1)
        fail(`${name} did not run exactly once on the previous release`);
      continue;
    }
    if (row.status !== "queued")
      fail(`${name} is ${row.status}; the previous release must leave it queued`);
    if (row.attempt !== 0) fail(`${name} spent ${row.attempt} attempt(s) on the previous release`);
    if (ranBy(previous, job.id) > 0) fail(`the previous release ran ${name}`);
    if (!previous.some((entry) => entry.event === "handed-back" && entry.jobId === job.id))
      fail(`the previous release never claimed and handed back ${name}`);
  }
  console.log("rollback: the previous release ran every v1 job and handed back every newer one");
}

/** The handler of every kind on this checkout's consumers: it records the run and acks. */
async function ran(job: ConsumerJob): Promise<void> {
  const line = {
    release: "current",
    event: "ran",
    kind: job.kind,
    jobId: job.jobId,
    v: job.payloadVersion,
  };
  appendFileSync(`${work}/current.jsonl`, `${JSON.stringify(line)}\n`);
  await Promise.resolve();
}

function startConsumers(database: DatabaseAdapter): () => Promise<void> {
  const logger = createShelfLogger({ level: "warn" });
  const { main, notify } = queuesOf(database);
  // The real handler's declaration (payload version 2, `accepts`); `run` only records.
  const notifyHandler = { ...createNotifyHandler({ deps: {} as never }), run: ran };
  const consumers = [
    createCaptureConsumer({
      queue: main,
      handlers: { capture: ran, publish: ran },
      config: { concurrency: 2 },
      logger,
    }),
    createCaptureConsumer({
      queue: notify,
      handlers: { notify: notifyHandler, "review-request": ran },
      config: { concurrency: 2 },
      logger,
    }),
  ];
  const running = consumers.map(async (consumer) => await consumer.start());
  return async (): Promise<void> => {
    await Promise.all(consumers.map(async (consumer) => await consumer.stop()));
    await Promise.all(running);
  };
}

/** Poll the rows once a second until every job is done or the deadline passed; the jobs left open. */
async function untilDone(
  database: DatabaseAdapter,
  jobs: Enqueued[],
  deadline: number,
): Promise<number> {
  await delay(1000);
  const rows = await rowsOf(database, jobs);
  const ended = rows.filter(({ row }) => ["failed", "cancelled"].includes(row.status));
  if (ended.length > 0)
    fail(
      ended
        .map(({ job, row }) => `${job.kind}@v${job.v} ended ${row.status}: ${row.error}`)
        .join("; "),
    );
  const remaining = rows.filter(({ row }) => row.status !== "done").length;
  return remaining === 0 || Date.now() >= deadline
    ? remaining
    : await untilDone(database, jobs, deadline);
}

async function consume(database: DatabaseAdapter): Promise<void> {
  const jobs = readJson<Enqueued[]>(jobsFile, []);
  const stop = startConsumers(database);
  const remaining = await untilDone(database, jobs, Date.now() + CONSUME_TIMEOUT_MS);
  await stop();
  if (remaining > 0) fail(`${remaining} job(s) still open after ${CONSUME_TIMEOUT_MS / 1000}s`);
  console.log(`consume: all ${jobs.length} jobs done`);
}

async function checkFinal(database: DatabaseAdapter): Promise<void> {
  const logs = [...readLog("previous"), ...readLog("current")];
  const counts = new Map<string, number>();
  for (const { job, row } of await rowsOf(database, readJson<Enqueued[]>(jobsFile, []))) {
    const name = `${job.kind}@v${job.v} ${job.id}`;
    if (row.status !== "done") fail(`${name} is ${row.status}`);
    const runs = logs.filter((entry) => entry.event === "ran" && entry.jobId === job.id);
    const [run] = runs;
    if (run === undefined || runs.length !== 1) fail(`${name} ran ${runs.length} times`);
    const release = run.release;
    if (job.v > 1 && release !== "current") fail(`${name} ran on the ${release} release`);
    const key = `${job.kind}@v${job.v} on ${release}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const handedBack = logs.filter((entry) => entry.event === "handed-back").length;
  console.log(`final: every job done once; ${handedBack} hand-back(s) by the previous release`);
  for (const [key, n] of [...counts].toSorted()) console.log(`  ${n} x ${key}`);
}

const [phase, batch] = process.argv.slice(2);
const database = await open();
await database.lifecycle?.setup({
  config: {},
  logger: createShelfLogger({ level: "warn" }),
  release: process.env["RELEASE"],
});
try {
  if (phase === "enqueue") await enqueue(database, batch ?? "1");
  else if (phase === "rollback") await checkRollback(database);
  else if (phase === "consume") await consume(database);
  else if (phase === "final") await checkFinal(database);
  else fail(`unknown phase: ${phase}`);
} finally {
  await database.lifecycle?.teardown?.();
}
