import { createShelfLogger } from "@storyshelf/core/logger";
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
  it("serializes a deletion claim against an in-flight admission in another process", async () => {
    await withDatabase(async (path) => {
      const lifecycle = createBuildReferenceLifecycle(path);
      let child: ReturnType<typeof spawn> | undefined;
      let errors = "";
      let exited: Promise<unknown[]> | undefined;
      await lifecycle.replaceReferences(owner, ["one"], async () => {
        const script = `import('./src/build-reference-lifecycle.ts').then(async ({ createBuildReferenceLifecycle }) => {
          await import('node:fs').then(({ writeFileSync }) => writeFileSync(process.argv[1] + '.ready', 'ready'));
          const result = await createBuildReferenceLifecycle(process.argv[1]).claimDeletion('p', 'one');
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
