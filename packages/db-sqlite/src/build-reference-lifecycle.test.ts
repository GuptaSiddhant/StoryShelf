import { createShelfLogger } from "@storyshelf/core/logger";
import { BaselineModel, BaselineTransferModel } from "@storyshelf/core/models";
import { makeStorage } from "@storyshelf/core/test-helpers";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";
import { createSqliteDatabase } from "./index.ts";
import { schema } from "./schema/index.ts";

const now = "2026-01-01T00:00:00.000Z";
const owner = { projectId: "p", type: "baseline", id: "base" } as const;
async function withDatabase(run: (path: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-build-reference-"));
  const path = join(dir, "test.sqlite");
  const db = createSqliteDatabase(path);
  try {
    await db.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
    await db.insert(schema.projects, {
      id: "p",
      name: "Project",
      slug: "p",
      createdAt: now,
      updatedAt: now,
    });
    for (const id of ["one", "two"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- create the records before opening another connection
      await db.insert(schema.builds, {
        id,
        projectId: "p",
        gitSha: id,
        gitBranch: "main",
        createdAt: now,
        updatedAt: now,
      });
    }
    await run(path);
  } finally {
    await db.lifecycle?.teardown();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("SQLite reference lifecycle primitive", () => {
  it("protects referenced builds and leaves deletion tombstones irreversible across connections", async () => {
    await withDatabase(async (path) => {
      const first = createBuildReferenceLifecycle(path);
      const second = createBuildReferenceLifecycle(path);
      await first.replaceReferences(owner, ["one", "one"], async () => await Promise.resolve());
      expect(await second.claimDeletion("p", "one")).toBe("protected");
      await first.replaceReferences(owner, ["two"], async () => await Promise.resolve());
      expect(await second.claimDeletion("p", "one")).toBe("claimed");
      expect(await first.claimDeletion("p", "one")).toBe("deleting");
      await expect(
        first.replaceReferences(owner, ["one"], async () => await Promise.resolve()),
      ).rejects.toThrow("unavailable");
      expect(await second.claimDeletion("p", "two")).toBe("protected");
      expect(await second.claimDeletion("p", "absent")).toBe("missing");
    });
  });
  it("rolls back domain writes and reference changes together", async () => {
    await withDatabase(async (path) => {
      const lifecycle = createBuildReferenceLifecycle(path);
      await lifecycle.replaceReferences(owner, ["one"], async () => await Promise.resolve());
      await expect(
        lifecycle.replaceReferences(owner, ["two"], async (tx) => {
          await tx.update(schema.projects, "p", { name: "changed" });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      const read = createSqliteDatabase(path);
      try {
        expect((await read.get(schema.projects, "p"))?.["name"]).toBe("Project");
      } finally {
        await read.lifecycle?.teardown();
      }
      expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
      expect(await lifecycle.claimDeletion("p", "two")).toBe("claimed");
    });
  });
  it("does not partially update owners when a multi-owner admission fails", async () => {
    await withDatabase(async (path) => {
      const lifecycle = createBuildReferenceLifecycle(path);
      const other = { ...owner, id: "other" };
      await lifecycle.replaceManyReferences(
        [
          { owner, buildIds: ["one"] },
          { owner: other, buildIds: ["two"] },
        ],
        async () => await Promise.resolve(),
      );
      await expect(
        lifecycle.replaceManyReferences(
          [
            { owner, buildIds: [] },
            { owner: other, buildIds: ["missing"] },
          ],
          async () => await Promise.resolve(),
        ),
      ).rejects.toThrow("unavailable");
      expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
      expect(await lifecycle.claimDeletion("p", "two")).toBe("protected");
      await expect(
        lifecycle.replaceManyReferences(
          [
            { owner, buildIds: [] },
            { owner, buildIds: [] },
          ],
          async () => await Promise.resolve(),
        ),
      ).rejects.toThrow("Duplicate reference owner");
    });
  });
  it("commits baseline promotions together with their source references", async () => {
    await withDatabase(async (path) => {
      const db = createSqliteDatabase(path);
      const lifecycle = createBuildReferenceLifecycle(path);
      Object.assign(db, { buildReferenceLifecycle: lifecycle });
      const { storage } = makeStorage();
      const png = Buffer.from([1, 2, 3]);
      await storage.write("one.png", png);
      await storage.write("two.png", png);
      const base = {
        projectId: "p",
        storyId: "story",
        storyName: "Story",
        storyTitle: "Story",
        viewportName: "desktop",
        browser: "chromium",
        createdAt: now,
        updatedAt: now,
      };
      try {
        await db.insert(schema.snapshots, {
          ...base,
          id: "snap-one",
          buildId: "one",
          screenshotPath: "one.png",
        });
        await db.insert(schema.snapshots, {
          ...base,
          id: "snap-two",
          buildId: "two",
          screenshotPath: "two.png",
        });
        const model = new BaselineModel(db, undefined, storage);
        const created = await model.upsert("p", "story", "desktop", "main", "snap-one", "one.png");
        expect(created.sourceBuildId).toBe("one");
        expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
        const updated = await model.upsert("p", "story", "desktop", "main", "snap-two", "two.png");
        expect(updated.id).toBe(created.id);
        expect(updated.sourceBuildId).toBe("two");
        expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
        expect(await lifecycle.claimDeletion("p", "two")).toBe("protected");
      } finally {
        await db.lifecycle?.teardown();
      }
    });
  });
  it("releases a source only after the last baseline owner is removed", async () => {
    await withDatabase(async (path) => {
      const db = createSqliteDatabase(path);
      const lifecycle = createBuildReferenceLifecycle(path);
      Object.assign(db, { buildReferenceLifecycle: lifecycle });
      const { storage } = makeStorage();
      await storage.write("shot.png", Buffer.from([1, 2, 3]));
      try {
        await db.insert(schema.snapshots, {
          id: "snap",
          projectId: "p",
          buildId: "one",
          storyId: "story",
          storyName: "Story",
          storyTitle: "Story",
          viewportName: "desktop",
          browser: "chromium",
          screenshotPath: "shot.png",
          createdAt: now,
          updatedAt: now,
        });
        const model = new BaselineModel(db, undefined, storage);
        await model.upsert("p", "story", "desktop", "main", "snap", "shot.png");
        await model.upsert("p", "story", "desktop", "feature", "snap", "shot.png");
        expect(await model.removeForBranch("p", "feature")).toBe(1);
        expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
        expect(await model.removeForBranch("p", "main")).toBe(1);
        expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
      } finally {
        await db.lifecycle?.teardown();
      }
    });
  });
  it("atomically releases the prior source when an archive replaces a baseline", async () => {
    await withDatabase(async (path) => {
      const db = createSqliteDatabase(path);
      const lifecycle = createBuildReferenceLifecycle(path);
      Object.assign(db, { buildReferenceLifecycle: lifecycle });
      const { storage } = makeStorage();
      await storage.write("shot.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      try {
        await db.insert(schema.snapshots, {
          id: "snap",
          projectId: "p",
          buildId: "one",
          storyId: "story",
          storyName: "Story",
          storyTitle: "Story",
          viewportName: "desktop",
          browser: "chromium",
          screenshotPath: "shot.png",
          createdAt: now,
          updatedAt: now,
        });
        const model = new BaselineModel(db, undefined, storage);
        await model.upsert("p", "story", "desktop", "main", "snap", "shot.png");
        const transfer = new BaselineTransferModel(db, storage);
        const chunks: Buffer[] = [];
        for await (const chunk of await transfer.export("p")) chunks.push(chunk);
        expect((await transfer.import("p", Buffer.concat(chunks))).updated).toBe(1);
        expect((await model.getFor("p", "story", "desktop", "main"))?.sourceBuildId).toBeNull();
        expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
      } finally {
        await db.lifecycle?.teardown();
      }
    });
  });
  it("does not block the event loop when two connections compete in one process", async () => {
    await withDatabase(async (path) => {
      const first = createBuildReferenceLifecycle(path);
      const second = createBuildReferenceLifecycle(path);
      const entered = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      const admission = first.replaceReferences(owner, ["one"], async () => {
        entered.resolve(true);
        await release.promise;
      });
      await entered.promise;
      const deletion = second.claimDeletion("p", "one");
      await delay(30);
      release.resolve(true);
      await admission;
      expect(await deletion).toBe("protected");
    });
  });
  it("serializes a deletion claim against an in-flight admission in another process", async () => {
    await withDatabase(async (path) => {
      const lifecycle = createBuildReferenceLifecycle(path);
      let child: ReturnType<typeof spawn> | undefined;
      let errors = "";
      let exited: Promise<unknown[]> | undefined;
      await lifecycle.replaceReferences(owner, ["one"], async () => {
        const script = `import('./src/build-reference-lifecycle.ts').then(async ({ createBuildReferenceLifecycle }) => {
          const { writeFileSync } = await import('node:fs');
          const result = await createBuildReferenceLifecycle(process.argv[1], () => writeFileSync(process.argv[1] + '.ready', 'blocked')).claimDeletion('p', 'one');
          await import('node:fs').then(({ writeFileSync }) => writeFileSync(process.argv[1] + '.result', result));
        }).catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });`;
        child = spawn(process.execPath, ["--experimental-strip-types", "-e", script, path], {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        exited = once(child, "close");
        child.stderr!.on("data", (chunk: Buffer) => {
          errors += chunk.toString();
        });
        for (let attempt = 0; attempt < 200 && !existsSync(`${path}.ready`); attempt += 1) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- poll until the separate process holds its request
          await delay(10);
        }
        if (!existsSync(`${path}.ready`)) throw new Error(errors || "child did not start");
      });
      if (!child || !exited) throw new Error("child did not start");
      const [code] = await exited;
      expect(code).toBe(0);
      expect(readFileSync(`${path}.result`, "utf8")).toBe("protected");
    });
  }, 15_000);
  it("rejects missing and cross-project builds without dropping existing references", async () => {
    await withDatabase(async (path) => {
      const lifecycle = createBuildReferenceLifecycle(path);
      await lifecycle.replaceReferences(owner, ["one"], async () => await Promise.resolve());
      await expect(
        lifecycle.replaceReferences(owner, ["missing"], async () => await Promise.resolve()),
      ).rejects.toThrow("unavailable");
      expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
      await expect(
        lifecycle.replaceReferences(
          { ...owner, projectId: "other" },
          ["one"],
          async () => await Promise.resolve(),
        ),
      ).rejects.toThrow("unavailable");
    });
  });
});
