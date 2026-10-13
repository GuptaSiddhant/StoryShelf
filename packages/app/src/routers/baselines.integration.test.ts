import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { BaselineModel, MemberModel, TokenModel } from "@storyshelf/core/models";
import type { Baseline } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { sha256 } from "@storyshelf/core/utils";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import AdmZip from "adm-zip";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const silentLogger = pino({ level: "silent" });
const NOW = "2026-01-01T00:00:00.000Z";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (tag: string): Buffer => Buffer.concat([PNG_SIGNATURE, Buffer.from(tag)]);

/** story, mode, branch, browser */
const IDENTITIES = [
  ["button--primary", "desktop", "main", "chromium"],
  ["button--primary", "mobile", "main", "chromium"],
  ["button--primary", "desktop", "main", "webkit"],
  ["card--default", "desktop", "main", "chromium"],
  ["card--default", "desktop", "feature/login", "chromium"],
] as const;

async function insertProject(db: DatabaseAdapter, id: string, slug: string): Promise<void> {
  await db.insert(db.tables.projects, {
    id,
    name: slug,
    slug,
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function seedBaselines(db: DatabaseAdapter, storage: StorageAdapter): Promise<void> {
  const model = new BaselineModel(db, undefined, storage);
  await Promise.all(
    IDENTITIES.map(async ([storyId, viewport, branch, browser]) => {
      const source = `src/${storyId}/${viewport}/${branch}/${browser}`;
      await storage.write(source, png(source));
      await model.upsert("p1", storyId, viewport, branch, "snap-1", source, `infra-${viewport}`, {
        browser,
        mode: viewport === "mobile" ? '{"viewport":"mobile"}' : null,
      });
    }),
  );
}

async function sqliteSetup() {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: silentLogger });
  const { storage, objects } = makeStorage();
  await insertProject(db, "p1", "demo");
  await seedBaselines(db, storage);
  const app = createShelfApp({ database: db, storage, logger: silentLogger });
  return { app, db, storage, objects };
}

const zipPost = (body: Buffer | string, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/zip", ...headers },
  body: typeof body === "string" ? body : new Uint8Array(body),
});

/** Every field resolve() returns, minus the instance-local row id and snapshot link. */
async function resolvedState(db: DatabaseAdapter, storage: StorageAdapter) {
  const model = new BaselineModel(db, undefined, storage);
  return await Promise.all(
    IDENTITIES.map(async ([storyId, viewport, branch, browser]) => {
      const found = await model.resolve("p1", storyId, viewport, branch, "main", browser);
      if (!found) {
        return null;
      }
      const { id: _id, snapshotId: _snapshotId, ...rest } = found as Baseline;
      return { ...rest, image: (await model.read(found)).toString("base64") };
    }),
  );
}

describe("baseline export/import API", () => {
  it("round-trips losslessly on SQLite: export -> wipe -> import -> resolve() identical", async () => {
    const { app, db, storage, objects } = await sqliteSetup();
    const before = await resolvedState(db, storage);
    expect(before.every((state) => state !== null)).toBe(true);

    const exported = await app.request("/api/v1/projects/demo/baselines/export");
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/zip");
    expect(exported.headers.get("content-disposition")).toContain("demo-baselines.zip");
    const archive = Buffer.from(await exported.arrayBuffer());

    const model = new BaselineModel(db, undefined, storage);
    await Promise.all(
      (await model.list("p1")).map(async (row) => {
        objects.delete(row.screenshotPath);
        await db.remove(db.tables.baselines, row.id);
      }),
    );
    expect(await resolvedState(db, storage)).toEqual(IDENTITIES.map(() => null));

    const imported = await app.request("/api/v1/projects/demo/baselines/import", zipPost(archive));
    expect(imported.status).toBe(200);
    expect(await imported.json()).toEqual({ imported: 5, created: 5, updated: 0 });
    expect(await resolvedState(db, storage)).toEqual(before);

    const again = await app.request("/api/v1/projects/demo/baselines/import", zipPost(archive));
    expect(await again.json()).toEqual({ imported: 5, created: 0, updated: 5 });
  });

  it("filters the export by branch and mirrors the storage layout", async () => {
    const { app } = await sqliteSetup();
    const response = await app.request(
      "/api/v1/projects/demo/baselines/export?branch=feature%2Flogin",
    );
    expect(response.headers.get("content-disposition")).toContain(
      "demo-baselines-feature_login.zip",
    );
    const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
    expect(zip.getEntries().map((entry) => entry.entryName)).toEqual([
      "baselines/feature/login/card--default/desktop.png",
      "manifest.json",
    ]);
    const manifest = JSON.parse(String(zip.readFile("manifest.json"))) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      format: "storyshelf-baselines",
      version: 1,
      project: "demo",
      branch: "feature/login",
    });
  });

  it("rejects malformed archives with 400 and writes nothing", async () => {
    const { app, db, storage } = await sqliteSetup();
    const before = await resolvedState(db, storage);
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from('{"format":"chromatic"}'));
    const statuses = await Promise.all(
      [zip.toBuffer(), Buffer.from("not a zip")].map(async (body) => {
        const response = await app.request("/api/v1/projects/demo/baselines/import", zipPost(body));
        return response.status;
      }),
    );
    expect(statuses).toEqual([400, 400]);
    expect(await resolvedState(db, storage)).toEqual(before);
  });

  it("rejects archives over the size limit with 413", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await insertProject(db, "p1", "demo");
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      config: { maxUploadBytes: 16 },
    });
    const response = await app.request(
      "/api/v1/projects/demo/baselines/import",
      zipPost("x".repeat(64)),
    );
    expect(response.status).toBe(413);
  });

  it("returns 404 for unknown projects", async () => {
    const { app } = await sqliteSetup();
    expect((await app.request("/api/v1/projects/nope/baselines/export")).status).toBe(404);
  });
});

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

describe("baseline export/import permissions", () => {
  const users = {
    dev: { id: "dev_1", email: "dev@example.com", name: "Dev", role: "member" as const },
    approver: { id: "ok_1", email: "ok@example.com", name: "Ok", role: "member" as const },
  };

  async function seedWithAuth() {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await insertProject(db, "p1", "demo");
    await seedBaselines(db, storage);
    await Promise.all(
      Object.values(users).map(async (user) => {
        await db.insert(db.tables.users, {
          ...user,
          avatarUrl: null,
          lastLoginAt: null,
          createdAt: NOW,
        });
      }),
    );
    await new MemberModel(db).set("p1", users.dev.id, "developer");
    await new MemberModel(db).set("p1", users.approver.id, "approver");
    const tokens = new TokenModel(db);
    await tokens.create("p1", { name: "dev", hash: sha256("dev-token"), userId: users.dev.id });
    await tokens.create("p1", { name: "ok", hash: sha256("ok-token"), userId: users.approver.id });
    await tokens.create("p1", { name: "legacy", hash: sha256("viewer-token"), userId: null });
    const app = createShelfApp({
      database: db,
      storage,
      auth: stubAuth(null),
      logger: silentLogger,
      config: { secret: "s" },
    });
    return { app };
  }

  it("lets viewers export but only approvers import", async () => {
    const { app } = await seedWithAuth();
    const exported = await app.request("/api/v1/projects/demo/baselines/export", {
      headers: bearer("viewer-token"),
    });
    expect(exported.status).toBe(200);
    const archive = Buffer.from(await exported.arrayBuffer());
    const path = "/api/v1/projects/demo/baselines/import";

    expect((await app.request(path, zipPost(archive, bearer("viewer-token")))).status).toBe(403);
    expect((await app.request(path, zipPost(archive, bearer("dev-token")))).status).toBe(403);
    expect((await app.request(path, zipPost(archive, bearer("ok-token")))).status).toBe(200);
  });

  it("requires authentication when auth is enabled", async () => {
    const { app } = await seedWithAuth();
    const response = await app.request("/api/v1/projects/demo/baselines/export");
    expect([401, 403]).toContain(response.status);
  });
});
