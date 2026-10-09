import { AiError, type Ai } from "@storyshelf/core/ai";
import { AiBudgetAlertModel, AiUsageModel, BuildModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { AuthUser } from "@storyshelf/core/types";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { settleInsightJobs } from "../insights/job.ts";
import { fakeAi } from "../insights/test-support.ts";
import { stubAuth } from "../stub-auth.ts";

const admin: AuthUser = { id: "admin_1", email: "a@x.io", name: "A", role: "admin" };
const dev: AuthUser = { id: "dev_1", email: "d@x.io", name: "D", role: "member" };
const approver: AuthUser = { id: "app_1", email: "p@x.io", name: "P", role: "member" };
const viewer: AuthUser = { id: "view_1", email: "v@x.io", name: "V", role: "member" };
const users = { admin, dev, approver, viewer };

const auth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    const name = /storyshelf_session=(?<name>\w+)/u.exec(cookie)?.groups?.["name"];
    return name && name in users ? users[name as keyof typeof users] : null;
  },
});

const cookie = (who: keyof typeof users): Record<string, string> => ({
  cookie: `storyshelf_session=${who}`,
  "content-type": "application/json",
});

async function seed(aiProfile: string | null = "default") {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "P",
    slug: "p",
    gitRepository: null,
    gitDefaultBranch: "main",
    aiProfile,
    createdAt: now,
    updatedAt: now,
  });
  await Promise.all(
    (
      [
        [dev, "developer"],
        [approver, "approver"],
        [viewer, "viewer"],
      ] as const
    ).flatMap(([user, role]) => [
      db.insert(db.tables.users, {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: null,
        role: user.role,
        lastLoginAt: null,
        createdAt: now,
        passwordHash: null,
        displayNameOverride: null,
        authProvider: "local",
        disabled: false,
      }),
      db.insert(db.tables.projectMembers, {
        id: `m_${user.id}`,
        projectId: "p1",
        userId: user.id,
        role,
        source: "manual",
        createdAt: now,
      }),
    ]),
  );
  await db.insert(db.tables.users, {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    avatarUrl: null,
    role: "admin",
    lastLoginAt: null,
    createdAt: now,
    passwordHash: null,
    displayNameOverride: null,
    authProvider: "local",
    disabled: false,
  });
  const build = await new BuildModel(db).create("p1", { gitSha: "abc", gitBranch: "main" });
  return { db, storage, buildId: build.id };
}

function appWith(db: unknown, storage: unknown, ai?: Ai) {
  return createShelfApp({
    database: db as never,
    storage: storage as never,
    auth,
    ...(ai ? { ai } : {}),
    logger: pino({ level: "silent" }),
  });
}

const path = (buildId: string) => `/api/v1/projects/p/builds/${buildId}/insights`;

describe("insights API guards", () => {
  it("returns 501 ai-disabled when AI is not configured", async () => {
    const { db, storage, buildId } = await seed();
    const res = await appWith(db, storage).request(`${path(buildId)}/latest`, {
      headers: cookie("admin"),
    });
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ message: "ai-disabled" });
  });

  it("returns 409 when the project has no ai_profile and 404 before generation", async () => {
    const off = await seed(null);
    const offApp = appWith(off.db, off.storage, fakeAi());
    const blocked = await offApp.request(path(off.buildId), {
      method: "POST",
      headers: cookie("admin"),
      body: "{}",
    });
    expect(blocked.status).toBe(409);
    const on = await seed();
    const onApp = appWith(on.db, on.storage, fakeAi());
    const none = await onApp.request(`${path(on.buildId)}/latest`, { headers: cookie("viewer") });
    expect(none.status).toBe(404);
  });

  it("lets all roles read but only approver/admin regenerate", async () => {
    const { db, storage, buildId } = await seed();
    const app = appWith(db, storage, fakeAi());
    const post = (who: keyof typeof users) =>
      app.request(path(buildId), { method: "POST", headers: cookie(who), body: "{}" });
    expect((await post("viewer")).status).toBe(403);
    expect((await post("dev")).status).toBe(403);
    expect((await post("approver")).status).toBe(202);
    await settleInsightJobs();
    expect(
      (await app.request(`${path(buildId)}/latest`, { headers: cookie("viewer") })).status,
    ).toBe(200);
  });
});

describe("insights generation", () => {
  it("runs once, then serves the cache; force reruns", async () => {
    const { db, storage, buildId } = await seed();
    const ai = fakeAi();
    const app = appWith(db, storage, ai);
    const first = await app.request(path(buildId), {
      method: "POST",
      headers: cookie("admin"),
      body: "{}",
    });
    expect(first.status).toBe(202);
    expect(first.headers.get("location")).toContain("/insights/latest");
    await settleInsightJobs();
    const latest = (await (
      await app.request(`${path(buildId)}/latest`, { headers: cookie("admin") })
    ).json()) as Record<string, unknown>;
    expect(latest).toMatchObject({ status: "done", verdict: "needs-review", profile: "default" });
    const cached = await app.request(path(buildId), {
      method: "POST",
      headers: cookie("admin"),
      body: "{}",
    });
    expect(cached.status).toBe(200);
    expect(ai.calls).toHaveLength(1);
    const forced = await app.request(path(buildId), {
      method: "POST",
      headers: cookie("admin"),
      body: JSON.stringify({ force: true }),
    });
    expect(forced.status).toBe(202);
    await settleInsightJobs();
    expect(ai.calls).toHaveLength(2);
    const history = (await (
      await app.request(path(buildId), { headers: cookie("viewer") })
    ).json()) as unknown[];
    expect(history).toHaveLength(1);
  });

  it("honours a profile override only for site admins", async () => {
    const { db, storage, buildId } = await seed();
    const ai = fakeAi();
    const app = appWith(db, storage, ai);
    await app.request(path(buildId), {
      method: "POST",
      headers: cookie("approver"),
      body: JSON.stringify({ profile: "thorough", force: true }),
    });
    await settleInsightJobs();
    expect(ai.calls.at(-1)?.profile).toBe("default");
    await app.request(path(buildId), {
      method: "POST",
      headers: cookie("admin"),
      body: JSON.stringify({ profile: "thorough", force: true }),
    });
    await settleInsightJobs();
    expect(ai.calls.at(-1)?.profile).toBe("thorough");
  });

  it("records failures with an error code and the usage the provider billed", async () => {
    const { db, storage, buildId } = await seed();
    const usage = { inputTokens: 7, outputTokens: 0, estimated: false };
    const app = appWith(db, storage, fakeAi({ fail: new AiError("provider", "boom", usage) }));
    await app.request(path(buildId), { method: "POST", headers: cookie("admin"), body: "{}" });
    await settleInsightJobs();
    const latest = (await (
      await app.request(`${path(buildId)}/latest`, { headers: cookie("admin") })
    ).json()) as Record<string, unknown>;
    expect(latest).toMatchObject({ status: "failed", errorCode: "provider" });
    const rows = await new AiUsageModel(db).listSince("2000-01-01T00:00:00.000Z");
    expect(rows).toMatchObject([{ status: "failed", inputTokens: 7 }]);
  });

  it("enforces the DB-counted daily budget with Retry-After and fires each threshold once", async () => {
    const { db, storage, buildId } = await seed();
    const app = appWith(db, storage, fakeAi({ dailyTokens: 40 }));
    await app.request(path(buildId), { method: "POST", headers: cookie("admin"), body: "{}" });
    await settleInsightJobs();
    await app.request(path(buildId), {
      method: "POST",
      headers: cookie("admin"),
      body: JSON.stringify({ force: true }),
    });
    await settleInsightJobs();
    const over = await app.request(path(buildId), {
      method: "POST",
      headers: cookie("admin"),
      body: JSON.stringify({ force: true }),
    });
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    const day = new Date().toISOString().slice(0, 10);
    const claimed = (await new AiBudgetAlertModel(db).listForDay(day))
      .map((r) => r.threshold)
      .toSorted((a, b) => a - b);
    expect(claimed).toEqual([50, 75, 90, 100]);
    const cached = await app.request(path(buildId), {
      method: "POST",
      headers: cookie("admin"),
      body: "{}",
    });
    expect(cached.status).toBe(200);
  });
});

describe("project health", () => {
  it("validates the window, generates on demand and serves the cached digest", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage, fakeAi());
    const url = "/api/v1/projects/p/insights/health";
    const bad = await app.request(url, {
      method: "POST",
      headers: cookie("admin"),
      body: JSON.stringify({ window: "forever" }),
    });
    expect(bad.status).toBe(400);
    expect((await app.request(url, { headers: cookie("viewer") })).status).toBe(404);
    const started = await app.request(url, {
      method: "POST",
      headers: cookie("approver"),
      body: "{}",
    });
    expect(started.status).toBe(202);
    await settleInsightJobs();
    const digest = (await (await app.request(url, { headers: cookie("viewer") })).json()) as Record<
      string,
      unknown
    >;
    expect(digest).toMatchObject({
      kind: "health",
      window: "30d",
      status: "done",
      verdict: "healthy",
    });
  });
});

describe("stale runs", () => {
  it("marks a long-stuck run as interrupted when read", async () => {
    const { db, storage, buildId } = await seed();
    await db.insert(db.tables.insights, {
      id: "stuck",
      projectId: "p1",
      buildId,
      kind: "triage",
      windowKey: null,
      inputHash: "h",
      status: "running",
      profile: "default",
      model: "m",
      promptVersion: "v1",
      verdict: null,
      summary: null,
      result: null,
      errorCode: null,
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      startedAt: null,
      finishedAt: null,
    });
    const app = appWith(db, storage, fakeAi());
    const latest = (await (
      await app.request(`${path(buildId)}/latest`, { headers: cookie("viewer") })
    ).json()) as Record<string, unknown>;
    expect(latest).toMatchObject({ status: "failed", errorCode: "interrupted" });
  });
});
