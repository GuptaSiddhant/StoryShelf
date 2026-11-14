import { MemberModel, ProjectModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { ProjectRole } from "@storyshelf/core/types";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const ROLES: Record<string, ProjectRole> = { boss: "admin", dev: "developer", view: "viewer" };
const users = [...Object.keys(ROLES), "outsider"].map((id) => ({
  id,
  email: `${id}@example.com`,
  name: id,
  role: "member" as const,
}));
const auth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    const id = /storyshelf_session=(?<id>\w+)/u.exec(cookie)?.groups?.["id"];
    return await Promise.resolve(users.find((user) => user.id === id) ?? null);
  },
});

let scratchDir = "";
const stops: (() => Promise<void>)[] = [];
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-thresholds-"));
});
afterEach(async () => {
  try {
    await Promise.all(stops.splice(0).map(async (stop) => await stop()));
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});

async function boot() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Limits",
    slug: "limits",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await Promise.all(
    users.map(async (user) => {
      await db.insert(db.tables.users, {
        ...user,
        avatarUrl: null,
        lastLoginAt: null,
        createdAt: NOW,
      });
    }),
  );
  await Promise.all(
    Object.entries(ROLES).map(async ([id, role]) => await new MemberModel(db).set("p1", id, role)),
  );
  const app = createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    auth,
    config: { secret: "s", scratchDir, publicBaseUrl: "https://shelf.example" },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  stops.push(async () => await app.lifecycle.teardown());
  const save = async (id: string | null, fields: Record<string, string>) =>
    await app.request("/projects/limits/settings/thresholds", {
      method: "POST",
      headers: {
        ...(id ? { cookie: `storyshelf_session=${id}` } : {}),
        "x-csrf-token": getCsrfToken("s", id ?? undefined),
        "sec-fetch-site": "same-origin",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields).toString(),
    });
  const stored = async () => await new ProjectModel(db).getBySlug("limits");
  return { save, stored };
}

describe("diff thresholds are admin-only", () => {
  it("saves for a project admin", async () => {
    const { save, stored } = await boot();
    const saved = await save("boss", { pixelThreshold: "0.3", maxDiffRatio: "0.02" });
    expect(saved.status).toBeLessThan(400);
    expect(await stored()).toMatchObject({ pixelThreshold: 0.3, maxDiffRatio: 0.02 });
  });

  it("refuses everyone else and saves nothing", async () => {
    const { save, stored } = await boot();
    const before = await stored();
    for (const id of ["dev", "view", "outsider", null]) {
      // eslint-disable-next-line no-await-in-loop -- few users
      const refused = await save(id, { pixelThreshold: "0.9", maxDiffRatio: "0.9" });
      expect([302, 401, 403, 404], String(id)).toContain(refused.status);
    }
    expect(await stored()).toEqual(before);
  });
});
