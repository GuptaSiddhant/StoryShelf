import { BuildModel, MemberModel, UserModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";

async function setup(config: Record<string, unknown> = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Docs",
    slug: "docs",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { publicBaseUrl: undefined, ...config } as never,
  });
  return { app, db };
}

function post(
  app: Awaited<ReturnType<typeof setup>>["app"],
  path: string,
  body = {},
  host?: string,
) {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-csrf-token": getCsrfToken(),
      "hx-request": "true",
      ...(host ? { host } : {}),
    },
    body: new URLSearchParams(body).toString(),
  });
}

describe("get started card", () => {
  it("shows the card on the empty library and builds pages", async () => {
    const { app } = await setup();
    const pages = await Promise.all(
      ["/projects/docs/library", "/projects/docs/builds"].map(async (path) => {
        const res = await app.request(path);
        return await res.text();
      }),
    );
    for (const html of pages) {
      expect(html).toContain("Get your first build");
      expect(html).toContain("Create a token");
    }
  });

  it("never builds the command from the request Host", async () => {
    const { app } = await setup();
    const html = await (
      await post(app, "/projects/docs/get-started/token", {}, "evil.example.com")
    ).text();
    expect(html).not.toContain("evil.example.com");
    expect(html).toContain("--url &lt;your-storyshelf-url&gt;");
    expect(html).toContain("--slug docs");
    expect(html).toMatch(/STORYSHELF_TOKEN=shelf_/u);
  });

  it("uses the confirmed public origin when there is one", async () => {
    const { app } = await setup({ publicBaseUrl: "https://shelf.example.com" });
    const html = await (
      await post(app, "/projects/docs/get-started/token", {}, "evil.example.com")
    ).text();
    expect(html).toContain("--url https://shelf.example.com");
    expect(html).not.toContain("evil.example.com");
  });

  it("polls quietly until a build exists, then redirects to the builds list", async () => {
    const { app, db } = await setup();
    const waiting = await app.request("/projects/docs/get-started/status", {
      headers: { "hx-request": "true" },
    });
    expect(waiting.status).toBe(204);
    expect(waiting.headers.get("hx-redirect")).toBeNull();
    await new BuildModel(db).create("p1", { gitSha: "a".repeat(40), gitBranch: "main" } as never);
    const done = await app.request("/projects/docs/get-started/status", {
      headers: { "hx-request": "true" },
    });
    expect(done.headers.get("hx-redirect")).toBe("/projects/docs/builds");
  });
});

describe("add member by email", () => {
  it("resolves an email to a user and saves the member", async () => {
    const { app, db } = await setup();
    await new UserModel(db).upsert({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      role: "member",
    });
    const res = await post(app, "/projects/docs/settings/members", {
      email: " Ada@Example.com ",
      role: "developer",
    });
    expect([204, 302]).toContain(res.status);
    const members = await new MemberModel(db).list("p1");
    expect(members.map((m) => [m.userId, m.role])).toEqual([["u1", "developer"]]);
  });

  it("answers an unknown email with a clear error and saves nothing", async () => {
    const { app, db } = await setup();
    const res = await post(app, "/projects/docs/settings/members", {
      email: "nobody@example.com",
      role: "viewer",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("No account has the email nobody@example.com");
    expect(await new MemberModel(db).list("p1")).toEqual([]);
  });
});
