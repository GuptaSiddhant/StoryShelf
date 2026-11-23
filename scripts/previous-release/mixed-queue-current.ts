import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createReviewRequestEnqueuer } from "../../packages/app/src/review-request-data.ts";
import type { DatabaseAdapter } from "../../packages/core/src/adapters/database.ts";
import {
  createNotifyEnqueuer,
  createNotifyHandler,
} from "../../packages/core/src/build-state/notify-job.ts";
import { createCaptureConsumer } from "../../packages/core/src/jobs/consumer/index.ts";
import type { ConsumerJob, KindHandler } from "../../packages/core/src/jobs/consumer/types.ts";
import { createDatabaseCaptureQueue } from "../../packages/core/src/jobs/db-queue/index.ts";
import type { DatabaseCaptureQueue } from "../../packages/core/src/jobs/db-queue/types.ts";
import { createShelfLogger } from "../../packages/core/src/logger.ts";
import { CaptureJobModel } from "../../packages/core/src/models/capture-job.ts";
import type { CaptureJobKind, CaptureJobRow } from "../../packages/core/src/schema/capture-job.ts";
import { assertAboveAll, expectedOn, SYNTHETIC_VERSION, type Declared } from "./expectation.ts";
// oxlint-disable max-statements max-lines-per-function curly no-console
// The mixed-queue test of ADR 0053, decision 8, this checkout's side. Run from the repo root with
// `nub scripts/previous-release/mixed-queue-current.ts <phase>` on a database this checkout
// migrated; previous-release.sh runs the previous release's consumers (mixed-queue-previous.mjs)
// between and beside these phases. Phases:
//   enqueue <batch>  enqueue one job of every kind through this checkout's own enqueue paths,
//                    including a repository link's `notify` job at payload version 2; batch 1 also
//                    enqueues one synthetic job per queue at a version above anything either release
//                    declares (SYNTHETIC_VERSION);
//   rollback         after the previous release consumed alone: nothing failed; it ran every job at or
//                    below the versions IT DECLARED (it logs them at start) exactly once, and handed
//                    back every newer one unrun with no attempt spent, the synthetic jobs included;
//   consume          this checkout's consumers run until every real job ended (the previous release's
//                    run beside them), then: every job is `done`, ran exactly once, and each job the
//                    previous release declares too new for it ran here;
//   refuse           this checkout's consumers alone: each synthetic job is handed back by them too;
//   final            every real job done once; every synthetic job still queued, no attempt spent,
//                    never run, handed back by both releases.
// Env: DIALECT (sqlite|postgres), RELEASE, WORK (job list and consumer logs), DATABASE_URL or DATA_DIR.

interface Enqueued {
  id: string;
  kind: CaptureJobKind;
  v: number;
  /** A job no release can read: it must stay queued, handed back by every consumer. */
  synthetic?: boolean;
}
interface Recorded {
  release: string;
  event: "ran" | "handed-back" | "declared";
  kind: CaptureJobKind;
  jobId: string;
  v: number;
  /** `declared` lines: the highest payload version the release's handler for `kind` reads. */
  declared?: number;
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
    const { createSqliteDatabase } = await import("../../packages/db/src/sqlite/index.ts");
    return createSqliteDatabase(`${dataDir}/shelf.db`);
  }
  if (dialect === "postgres") {
    const { createPostgresDatabase } = await import("../../packages/db/src/postgres/index.ts");
    return createPostgresDatabase({ url: process.env["DATABASE_URL"] });
  }
  throw new Error(`unknown DIALECT: ${dialect}`);
}

function fail(message: string): never {
  throw new Error(`mixed-queue test FAILED (${dialect}): ${message}`);
}

const readJson = <T>(file: string, fallback: T): T =>
  existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
const realJobs = (): Enqueued[] =>
  readJson<Enqueued[]>(jobsFile, []).filter((job) => !job.synthetic);
const syntheticJobs = (): Enqueued[] =>
  readJson<Enqueued[]>(jobsFile, []).filter((job) => job.synthetic === true);
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
  const synthetic: Enqueued[] = [];
  if (batch === "1") {
    assertAboveAll(declaredOf(currentHandlers()));
    const data = { channelId: `channel-${batch}` };
    const v = SYNTHETIC_VERSION;
    // Through queues that record nothing: these are not real jobs.
    const plain = queuesOf(database);
    const queued = [
      [plain.main, "publish"],
      [plain.notify, "notify"],
    ] as const;
    const ids = await Promise.all(
      queued.map(
        async ([queue, kind]) =>
          await queue.enqueueJob({ kind, buildId: buildId(6), data, payloadVersion: v }),
      ),
    );
    synthetic.push(
      ...queued.map(([, kind], i) => ({ id: ids[i] ?? "", kind, v, synthetic: true })),
    );
  }
  const missing = Object.keys(KINDS).filter((kind) => !enqueued.some((job) => job.kind === kind));
  if (missing.length > 0) fail(`enqueued no ${missing.join(", ")} job`);
  if (!enqueued.some((job) => job.v > 1)) fail("enqueued no job at a newer payload version");
  const all = [...readJson<Enqueued[]>(jobsFile, []), ...enqueued, ...synthetic];
  writeFileSync(jobsFile, JSON.stringify(all));
  const names = [...enqueued, ...synthetic].map((job) => `${job.kind}@v${job.v}`);
  console.log(`batch ${batch}: ${names.join(", ")}`);
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

/** What the previous release said its handlers read, from its first log lines. */
function previousDeclared(): Declared {
  const declared: Record<string, number> = {};
  for (const entry of readLog("previous"))
    if (entry.event === "declared" && entry.declared !== undefined)
      declared[entry.kind] = entry.declared;
  const missing = Object.keys(KINDS).filter((kind) => declared[kind] === undefined);
  if (missing.length > 0)
    fail(`the previous release declared no payload version for ${missing.join(", ")}`);
  return declared;
}

async function checkRollback(database: DatabaseAdapter): Promise<void> {
  const previous = readLog("previous");
  const declared = previousDeclared();
  assertAboveAll(declared);
  console.log(`previous release declares: ${JSON.stringify(declared)}`);
  for (const { job, row } of await rowsOf(database, readJson<Enqueued[]>(jobsFile, []))) {
    const name = `${job.kind}@v${job.v} ${job.id}`;
    if (expectedOn(declared, job) === "run") {
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
  console.log(
    "rollback: the previous release ran what it declares and handed back every newer job",
  );
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

/** This checkout's handlers: the real `notify` declaration (`payloadVersion`, `accepts`); `run` only records. */
function currentHandlers(): Record<CaptureJobKind, KindHandler> {
  const notify = { ...createNotifyHandler({ deps: {} as never }), run: ran };
  return { capture: { run: ran }, publish: { run: ran }, notify, "review-request": { run: ran } };
}

const declaredOf = (handlers: Record<CaptureJobKind, KindHandler>): Declared =>
  Object.fromEntries(Object.entries(handlers).map(([kind, h]) => [kind, h.payloadVersion ?? 1]));

/** Record each hand-back this checkout's consumers make, as the previous release's consumer does. */
function recordHandBacks(queue: DatabaseCaptureQueue): DatabaseCaptureQueue {
  const handBack = queue.handBack;
  queue.handBack = async (polled, options): Promise<void> => {
    const job = polled as ConsumerJob;
    const line = { release: "current", event: "handed-back", kind: job.kind, jobId: job.jobId };
    appendFileSync(
      `${work}/current.jsonl`,
      `${JSON.stringify({ ...line, v: job.payloadVersion })}\n`,
    );
    await handBack?.(polled, options);
  };
  return queue;
}

function startConsumers(database: DatabaseAdapter): () => Promise<void> {
  const logger = createShelfLogger({ level: "warn" });
  const { main, notify } = queuesOf(database);
  const handlers = currentHandlers();
  const consumers = [
    createCaptureConsumer({
      queue: recordHandBacks(main),
      handlers: { capture: handlers.capture, publish: handlers.publish },
      config: { concurrency: 2 },
      logger,
    }),
    createCaptureConsumer({
      queue: recordHandBacks(notify),
      handlers: { notify: handlers.notify, "review-request": handlers["review-request"] },
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
  const jobs = realJobs();
  const stop = startConsumers(database);
  const remaining = await untilDone(database, jobs, Date.now() + CONSUME_TIMEOUT_MS);
  await stop();
  if (remaining > 0) fail(`${remaining} job(s) still open after ${CONSUME_TIMEOUT_MS / 1000}s`);
  console.log(`consume: all ${jobs.length} jobs done`);
}

const handedBackBy = (log: Recorded[], id: string): boolean =>
  log.some((entry) => entry.event === "handed-back" && entry.jobId === id);

/** Synthetic jobs: nobody may run one, nobody may spend an attempt on it; both releases hand it back. */
async function checkSynthetic(database: DatabaseAdapter): Promise<void> {
  const logs = { previous: readLog("previous"), current: readLog("current") };
  for (const { job, row } of await rowsOf(database, syntheticJobs())) {
    const name = `${job.kind}@v${job.v} ${job.id}`;
    if (row.status !== "queued")
      fail(`${name} is ${row.status}; every release must leave it queued`);
    if (row.attempt !== 0) fail(`${name} spent ${row.attempt} attempt(s)`);
    for (const [release, log] of Object.entries(logs)) {
      if (ranBy(log, job.id) > 0) fail(`the ${release} release ran ${name}`);
      if (!handedBackBy(log, job.id)) fail(`the ${release} release never handed back ${name}`);
    }
  }
  console.log(
    `synthetic: ${syntheticJobs().length} job(s) at v${SYNTHETIC_VERSION} handed back by both`,
  );
}

/** Poll once a second until nothing is pending or the deadline passed; what is still pending. */
async function untilHandedBack(pending: () => Enqueued[], deadline: number): Promise<Enqueued[]> {
  await delay(1000);
  return pending().length === 0 || Date.now() >= deadline
    ? pending()
    : await untilHandedBack(pending, deadline);
}

/** This checkout's consumers alone, until each synthetic job was claimed and handed back by them. */
async function refuse(database: DatabaseAdapter): Promise<void> {
  const jobs = syntheticJobs();
  const stop = startConsumers(database);
  const pending = (): Enqueued[] => jobs.filter((job) => !handedBackBy(readLog("current"), job.id));
  const left = await untilHandedBack(pending, Date.now() + CONSUME_TIMEOUT_MS);
  await stop();
  if (left.length > 0)
    fail(`this checkout never handed back ${left.map((job) => job.id).join(", ")}`);
  console.log("refuse: this checkout hands back a payload newer than it reads, like the previous");
}

async function checkFinal(database: DatabaseAdapter): Promise<void> {
  const logs = [...readLog("previous"), ...readLog("current")];
  const declared = previousDeclared();
  const counts = new Map<string, number>();
  for (const { job, row } of await rowsOf(database, realJobs())) {
    const name = `${job.kind}@v${job.v} ${job.id}`;
    if (row.status !== "done") fail(`${name} is ${row.status}`);
    const runs = logs.filter((entry) => entry.event === "ran" && entry.jobId === job.id);
    const [run] = runs;
    if (run === undefined || runs.length !== 1) fail(`${name} ran ${runs.length} times`);
    const release = run.release;
    if (expectedOn(declared, job) === "hand-back" && release !== "current")
      fail(`${name} ran on the ${release} release, which declares v${declared[job.kind]}`);
    const key = `${job.kind}@v${job.v} on ${release}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const handedBack = logs.filter((entry) => entry.event === "handed-back").length;
  console.log(`final: every job done once; ${handedBack} hand-back(s) by the previous release`);
  for (const [key, n] of [...counts].toSorted()) console.log(`  ${n} x ${key}`);
  await checkSynthetic(database);
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
  else if (phase === "refuse") await refuse(database);
  else if (phase === "final") await checkFinal(database);
  else fail(`unknown phase: ${phase}`);
} finally {
  await database.lifecycle?.teardown?.();
}
