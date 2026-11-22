import { createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
/**
 * Two OS processes claim from one local SQLite file at the same time (ADR 0006: local-file SQLite
 * supports the processes of one host). Every job must be claimed exactly once across both.
 * No sleeps: the processes start draining on the same "go" and the test waits on their reports.
 */
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const CHILD = fileURLToPath(new URL("test-helpers/queue-claimer-child.ts", import.meta.url));
const JOBS = 150;

interface Report {
  owner: string;
  ready?: boolean;
  claimed?: string[];
  error?: string;
}

function startClaimer(
  path: string,
  owner: string,
): { child: ChildProcess; next: () => Promise<Report> } {
  const child = fork(CHILD, [path, owner], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const inbox: Report[] = [];
  const waiting: ((report: Report) => void)[] = [];
  child.on("message", (message) => {
    const resolve = waiting.shift();
    if (resolve) {
      resolve(message as Report);
    } else {
      inbox.push(message as Report);
    }
  });
  const next = async (): Promise<Report> =>
    inbox.length > 0
      ? inbox.shift()!
      : await new Promise<Report>((resolve, reject) => {
          waiting.push(resolve);
          child.once("exit", (code) => {
            reject(new Error(`claimer ${owner} exited (${String(code)})`));
          });
        });
  return { child, next };
}

describe("database queue across two processes on one SQLite file", () => {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-queue-"));
  const children: ChildProcess[] = [];

  afterAll(() => {
    for (const child of children) {
      child.kill();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("claims every job exactly once", async () => {
    const path = join(dir, "queue.db");
    const db = createSqliteDatabase(path);
    await db.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
    const queue = createDatabaseCaptureQueue(db);
    const ids = Array.from({ length: JOBS }, (_unused, index) => `proc-${String(index)}`);
    for (const buildId of ids) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- enqueue order is the poll order
      await queue.enqueue({ buildId });
    }
    const claimers = [startClaimer(path, "proc-a"), startClaimer(path, "proc-b")];
    children.push(...claimers.map((claimer) => claimer.child));
    const ready = await Promise.all(claimers.map(async (claimer) => await claimer.next()));
    expect(ready.every((report) => report.ready === true)).toBe(true);
    for (const claimer of claimers) {
      claimer.child.send("go");
    }
    const reports = await Promise.all(claimers.map(async (claimer) => await claimer.next()));
    expect(reports.map((report) => report.error)).toEqual([undefined, undefined]);
    const all = reports.flatMap((report) => report.claimed ?? []);
    expect(all).toHaveLength(JOBS);
    expect(new Set(all)).toEqual(new Set(ids));
    const statuses = await Promise.all(ids.map(async (id) => (await queue.status(id))?.status));
    expect(new Set(statuses)).toEqual(new Set(["completed"]));
    await db.lifecycle?.teardown();
  }, 60_000);
});
