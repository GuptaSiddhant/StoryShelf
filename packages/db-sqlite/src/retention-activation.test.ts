import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";
import { createShelfLogger } from "@storyshelf/core/logger";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  createBuildReferenceLifecycle,
  prepareBaselineReferences,
} from "./build-reference-lifecycle.ts";
import { createSqliteDatabase } from "./index.ts";
import { schema } from "./schema/index.ts";

const now = "2026-01-01T00:00:00.000Z";
const baseline = {
  projectId: "p",
  storyId: "story",
  viewportName: "desktop",
  branch: "main",
  browser: "chromium",
  screenshotPath: "shot",
  snapshotId: "snap",
  createdAt: now,
  updatedAt: now,
};

/** A logger that records what the adapter reports; the rest is silent. */
function recordingLogger() {
  const info = vi.fn();
  const error = vi.fn();
  const logger = { info, error, warn: vi.fn(), debug: vi.fn() } as unknown as Logger;
  return { logger, info, error };
}

/** Open the database at `path` the way a server boots it: log binding, then setup. */
async function boot(path: string, logger: Logger = createShelfLogger({ level: "silent" })) {
  const db = createSqliteDatabase(path);
  db.setLogger?.(logger);
  await db.lifecycle?.setup({ config: {}, logger });
  return db;
}

async function withFile(run: (path: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-retention-activation-"));
  try {
    await run(join(dir, "test.sqlite"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A project with two builds, and a baseline whose recorded source is build "two". */
async function seed(db: DatabaseAdapter): Promise<void> {
  await db.insert(schema.projects, {
    id: "p",
    name: "P",
    slug: "p",
    createdAt: now,
    updatedAt: now,
  });
  for (const id of ["one", "two"]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- two rows, in order
    await db.insert(schema.builds, {
      id,
      projectId: "p",
      gitSha: id,
      gitBranch: "main",
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });
  }
  await db.insert(schema.baselines, { ...baseline, id: "base", sourceBuildId: "two" });
}

describe("SQLite retention activation", () => {
  it("exposes the capability after setup, once the baselines are prepared", async () => {
    await withFile(async (path) => {
      const { logger, info, error } = recordingLogger();
      const db = createSqliteDatabase(path);
      db.setLogger?.(logger);
      expect(db.buildReferenceLifecycle).toBeUndefined();

      await db.lifecycle?.setup({ config: {}, logger });

      expect(db.buildReferenceLifecycle).toBeDefined();
      expect(db.retentionPause).toBeUndefined();
      expect(error).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ protected: 0, unknown: 0, unavailable: 0 }),
        expect.stringContaining("build retention is active"),
      );
      await db.lifecycle?.teardown();
    });
  });

  it("pins the proven source of an existing baseline while preparing", async () => {
    await withFile(async (path) => {
      const first = await boot(path);
      await seed(first);
      await first.lifecycle?.teardown();

      const db = await boot(path);

      // The pin is real: the build the baseline came from cannot be claimed for deletion.
      expect(await db.buildReferenceLifecycle?.claimDeletion("p", "two")).toBe("protected");
      expect(await db.buildReferenceLifecycle?.claimDeletion("p", "one")).toBe("claimed");
      await db.lifecycle?.teardown();
    });
  });

  it("withholds the capability and names the baseline and build when a source is tombstoned", async () => {
    await withFile(async (path) => {
      const first = await boot(path);
      await seed(first);
      expect(await createBuildReferenceLifecycle(path).claimDeletion("p", "two")).toBe("claimed");
      await first.lifecycle?.teardown();
      const { logger, error } = recordingLogger();

      const db = await boot(path, logger);

      expect(db.buildReferenceLifecycle).toBeUndefined();
      expect(db.retentionPause).toEqual({
        baselineId: "base",
        buildId: "two",
        problem: "tombstoned",
      });
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        { baselineId: "base", buildId: "two", problem: "tombstoned" },
        expect.stringContaining("retention is paused"),
      );
      await db.lifecycle?.teardown();
    });
  });

  it("turns retention on after the data is fixed and the deployment restarted", async () => {
    await withFile(async (path) => {
      const first = await boot(path);
      await seed(first);
      await createBuildReferenceLifecycle(path).claimDeletion("p", "two");
      await first.lifecycle?.teardown();
      const paused = await boot(path);
      expect(paused.buildReferenceLifecycle).toBeUndefined();

      // The operator removes the baseline that points at the doomed build, and restarts.
      await paused.remove(schema.baselines, "base");
      await paused.lifecycle?.teardown();
      const restarted = await boot(path);

      expect(restarted.retentionPause).toBeUndefined();
      expect(restarted.buildReferenceLifecycle).toBeDefined();
      await restarted.lifecycle?.teardown();
    });
  });

  it("never exposes the capability for an in-memory database, which cannot share a file", async () => {
    const db = await boot(":memory:");
    expect(db.buildReferenceLifecycle).toBeUndefined();
    expect(db.retentionPause).toBeUndefined();
    await db.lifecycle?.teardown();
  });
});

/**
 * Preparation runs at every boot, so its cost is a startup cost (ADR 0039's budget is 5 s). Gated:
 * `RUN_BENCH=1 nubx vitest run src/retention-activation.test.ts -t "large fixture"`.
 */
describe.runIf(process.env["RUN_BENCH"] === "1")("preparation time", () => {
  it("prepares a large fixture inside the startup budget", async () => {
    await withFile(async (path) => {
      const count = 10_000;
      const seeded = await boot(path);
      await seeded.insert(schema.projects, {
        id: "p",
        name: "P",
        slug: "p",
        createdAt: now,
        updatedAt: now,
      });
      const raw = new DatabaseSync(path);
      raw.exec("BEGIN");
      const build = raw.prepare(
        "INSERT INTO builds (id, project_id, git_sha, git_branch, status, created_at, updated_at) VALUES (?, 'p', ?, 'main', 'approved', ?, ?)",
      );
      const base = raw.prepare(
        `INSERT INTO baselines (id, project_id, story_id, viewport_name, branch, browser, screenshot_path, snapshot_id, source_build_id, created_at, updated_at)
         VALUES (?, 'p', ?, 'desktop', 'main', 'chromium', 'shot', 'snap', ?, ?, ?)`,
      );
      for (let index = 0; index < count; index += 1) {
        const id = String(index).padStart(6, "0");
        build.run(`b${id}`, id, now, now);
        base.run(`a${id}`, `story-${id}`, `b${id}`, now, now);
      }
      raw.exec("COMMIT");
      raw.close();
      await seeded.lifecycle?.teardown();

      // First boot after the data exists pins every baseline; later boots find them pinned.
      const times: number[] = [];
      let db = await boot(path);
      for (let boots = 0; boots < 3; boots += 1) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- timed boots, one after another
        await db.lifecycle?.teardown();
        const startedAt = performance.now();
        // oxlint-disable-next-line eslint/no-await-in-loop -- timed boots, one after another
        db = await boot(path);
        times.push(Math.round(performance.now() - startedAt));
      }
      const prepareStartedAt = performance.now();
      await prepareBaselineReferences(path);
      const prepareMs = Math.round(performance.now() - prepareStartedAt);
      // eslint-disable-next-line no-console -- the figures are the point of this gated test
      console.log(
        `${count} baselines: boot (migrate + preparation) ${times.join(" / ")} ms, preparation alone ${prepareMs} ms`,
      );

      expect(db.buildReferenceLifecycle).toBeDefined();
      expect(Math.max(...times)).toBeLessThan(5000);
      await db.lifecycle?.teardown();
    });
  }, 120_000);
});
