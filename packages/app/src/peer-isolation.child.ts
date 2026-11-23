/**
 * Run by `peer-isolation.test.ts` in a fresh Node with the testing-only libraries unresolvable:
 * boot `createShelfApp` with `testing` off or on (argv[2]), then print a JSON report on stdout.
 */
import { createDatabaseCaptureQueue } from "@storyshelf/core/jobs";
import { BuildModel, CaptureJobModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import AdmZip from "adm-zip";
import { Writable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { pino } from "pino";
import { createShelfApp } from "./index.tsx";
import { stubRunner } from "./test-runner.ts";

/** The consumer's idle poll is 15 s (+ jitter), and this job is queued from outside the app's own queue. */
const NOTIFY_WAIT_MS = 30_000;
const testing = process.argv[2] === "testing";
/** Error-level log lines, so a consumer that stops at startup shows in the report. */
const errors: string[] = [];
const sink = new Writable({
  write(chunk: Buffer, _encoding, done): void {
    errors.push((JSON.parse(chunk.toString()) as { msg?: string }).msg ?? "");
    done();
  },
});
const { db } = makeDatabase();
const builds = new BuildModel(db);
const app = createShelfApp({
  database: db,
  storage: makeStorage().storage,
  logger: pino({ level: "error" }, sink),
  // Every zip goes to a queued `publish` job, so the hosting consumers have work to run.
  config: { maxInlineUnzipSize: 0 },
  ...(testing ? { testing: { runner: stubRunner() } } : {}),
});
const setup = await app.lifecycle.ready.then(
  (result) => (result.ok ? "ok" : result.failures.map((failure) => failure.error).join("; ")),
  (error: unknown) => (error instanceof Error ? error.message : String(error)),
);
const health = await app.request("/api/v1/health");
const report: Record<string, unknown> = { setup, health: health.status };
if (!testing) {
  const post = async (path: string, body: unknown): Promise<Response> =>
    await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const { slug } = (await (await post("/api/v1/projects", { name: "Docs" })).json()) as {
    slug: string;
  };
  const created = await post(`/api/v1/projects/${slug}/builds`, {
    gitSha: "1111111",
    gitBranch: "main",
  });
  const { uploadUrl, build } = (await created.json()) as {
    uploadUrl: string;
    build: { id: string };
  };
  const zip = new AdmZip();
  zip.addFile("iframe.html", Buffer.from("<html><body>storybook</body></html>"));
  zip.addFile("index.json", Buffer.from(JSON.stringify({ v: 4, entries: {} })));
  const upload = await app.request(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/zip" },
    body: new Uint8Array(zip.toBuffer()),
  });
  report["upload"] = upload.status;
  report["published"] = await publishedWithin(build.id, 10_000);
  // A `notify` job for a channel that is gone: the handler acks it (nothing is left to show), so it
  // ends `done` only when the notify consumer started without the image libraries.
  const notifyId = await createDatabaseCaptureQueue(db, { kinds: ["notify"] }).enqueueJob({
    kind: "notify",
    buildId: build.id,
    data: { channelId: "gone" },
  });
  report["notified"] = await notifiedWithin(notifyId, NOTIFY_WAIT_MS);
}
report["errors"] = errors;
async function publishedWithin(buildId: string, ms: number): Promise<boolean> {
  const build = await builds.get(buildId);
  if (build !== null && build.status !== "pending") {
    return true;
  }
  if (ms <= 0) {
    return false;
  }
  await sleep(100);
  return await publishedWithin(buildId, ms - 100);
}
async function notifiedWithin(jobId: string, ms: number): Promise<boolean> {
  if ((await new CaptureJobModel(db).get(jobId))?.status === "done") {
    return true;
  }
  if (ms <= 0) {
    return false;
  }
  await sleep(100);
  return await notifiedWithin(jobId, ms - 100);
}
await app.lifecycle.teardown();
process.stdout.write(`REPORT ${JSON.stringify(report)}\n`);
// oxlint-disable-next-line unicorn/no-process-exit -- adapter timers would keep this one-shot child alive
process.exit(0);
