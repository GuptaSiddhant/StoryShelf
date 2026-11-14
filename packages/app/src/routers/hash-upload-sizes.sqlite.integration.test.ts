import { createShelfLogger } from "@storyshelf/core/logger";
import { makeStorage } from "@storyshelf/core/test-helpers";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const STAMP = "2025-01-01T00:00:00.000Z";
const sha256 = (body: string): string => createHash("sha256").update(body).digest("hex");

/** A multipart body naming one file by its hash, as the CLI sends it. */
function form(body: string): FormData {
  const data = new FormData();
  data.set(sha256(body), new Blob([body]));
  return data;
}

/** A real SQLite file with a project and two pending builds, `old` and `fresh`. */
async function withDeployment(
  run: (ctx: {
    db: ReturnType<typeof createSqliteDatabase>;
    request: (path: string, init?: RequestInit) => Promise<Response>;
  }) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-hash-sizes-"));
  const db = createSqliteDatabase(join(dir, "shelf.sqlite"));
  try {
    await db.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, {
      id: "p",
      name: "P",
      slug: "p",
      gitDefaultBranch: "main",
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    for (const id of ["old", "fresh"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- two builds, in order
      await db.insert(db.tables.builds, {
        id,
        projectId: "p",
        gitSha: id,
        gitBranch: "main",
        status: "pending",
        createdAt: STAMP,
        updatedAt: STAMP,
      });
    }
    const app = createShelfApp({
      database: db,
      storage,
      logger: createShelfLogger({ level: "silent" }),
    });
    await run({ db, request: async (path, init) => await app.request(path, init) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("content-hash upload records blob sizes", () => {
  it("sizes new and already-stored blobs, and the Insights total matches", async () => {
    await withDeployment(async ({ db, request }) => {
      const put = async (build: string, body: string): Promise<Response> =>
        await request(`/api/v1/projects/p/builds/${build}/content`, {
          method: "POST",
          body: form(body),
        });
      const manifest = async (build: string, bodies: string[]): Promise<Response> =>
        await request(`/api/v1/projects/p/builds/${build}/manifest`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            files: bodies.map((body, index) => ({
              rel: `f${index}.js`,
              hash: sha256(body),
              size: 1,
            })),
          }),
        });

      // The first build uploads both blobs; the second finds one already stored and uploads one.
      const stored = "stored blob";
      const added = "a new blob, longer";
      expect((await put("old", stored)).status).toBe(200);
      expect((await manifest("old", [stored])).status).toBe(200);
      expect((await put("fresh", added)).status).toBe(200);
      expect((await manifest("fresh", [stored, added])).status).toBe(200);

      const lifecycle = db.buildReferenceLifecycle;
      const usage = await lifecycle?.contentUsage("p");
      expect(usage).toEqual({
        bytes: Buffer.byteLength(stored) + Buffer.byteLength(added),
        blobs: 2,
        unsized: 0,
      });
    });
  });
});
