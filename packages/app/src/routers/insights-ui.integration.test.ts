import { InsightModel } from "@storyshelf/core/models";
import { BuildModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { settleInsightJobs } from "../insights/job.ts";
import { fakeAi } from "../insights/test-support.ts";
import { getCsrfToken } from "../middleware/csrf.ts";

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
  const build = await new BuildModel(db).create("p1", { gitSha: "abc", gitBranch: "main" });
  return { db, storage, build };
}

const app = (db: unknown, storage: unknown, withAi = true) =>
  createShelfApp({
    database: db as never,
    storage: storage as never,
    ...(withAi ? { ai: fakeAi() } : {}),
    logger: pino({ level: "silent" }),
  });

const form = (body: Record<string, string>) =>
  ({
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-csrf-token": getCsrfToken(),
    },
    body: new URLSearchParams(body).toString(),
  }) as const;

describe("AI settings tab", () => {
  it("hides the tab and explains when AI is not configured", async () => {
    const { db, storage } = await seed();
    const html = await (await app(db, storage, false).request("/projects/p/settings/ai")).text();
    expect(html).toContain("AI is not configured");
    expect(html).not.toContain('/projects/p/settings/ai"');
  });

  it("lets a site admin choose a profile, rejects unknown ones and can turn AI off", async () => {
    const { db, storage } = await seed(null);
    const shelf = app(db, storage);
    expect(await (await shelf.request("/projects/p/settings/ai")).text()).toContain(
      'name="aiProfile"',
    );
    const bad = await shelf.request("/projects/p/settings/ai", form({ aiProfile: "ghost" }));
    expect(bad.status).toBe(400);
    const ok = await shelf.request("/projects/p/settings/ai", form({ aiProfile: "thorough" }));
    expect([204, 302]).toContain(ok.status);
    expect(
      ((await (await shelf.request("/api/v1/projects/p")).json()) as { aiProfile?: string })
        .aiProfile,
    ).toBe("thorough");
    await shelf.request("/projects/p/settings/ai", form({ aiProfile: "" }));
    expect(
      ((await (await shelf.request("/api/v1/projects/p")).json()) as { aiProfile?: string | null })
        .aiProfile ?? null,
    ).toBeNull();
  });
});

describe("build review insight panel", () => {
  it("is absent without AI or without a project profile", async () => {
    const off = await seed(null);
    expect(
      (await app(off.db, off.storage).request(`/projects/p/builds/${off.build.id}/insights/panel`))
        .status,
    ).toBe(404);
    const none = await seed();
    expect(
      (
        await app(none.db, none.storage, false).request(
          `/projects/p/builds/${none.build.id}/insights/panel`,
        )
      ).status,
    ).toBe(501);
  });

  it("generates through the form, renders the verdict as plain text and escapes output", async () => {
    const { db, storage, build } = await seed();
    const shelf = app(db, storage);
    const started = await shelf.request(
      `/projects/p/builds/${build.id}/insights/generate`,
      form({ force: "false" }),
    );
    expect(started.status).toBe(200);
    expect(await started.text()).toContain("generating");
    await settleInsightJobs();
    const [row] = await new InsightModel(db).listForBuild(build.id, 1);
    await db.update(db.tables.insights, row!.id, {
      summary: "<script>alert(1)</script>",
      result: JSON.stringify({
        output: { items: [{ snapshotKey: "<b>k</b>", note: "n", severity: "low" }] },
        meta: {},
      }),
    });
    const html = await (
      await shelf.request(`/projects/p/builds/${build.id}/insights/panel`)
    ).text();
    expect(html).toContain("needs-review");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<b>k</b>");
    expect(html).toContain("Regenerate");
  });

  it("shows the panel on the review page when the project has a profile", async () => {
    const { db, storage, build } = await seed();
    const html = await (
      await app(db, storage).request(`/projects/p/builds/${build.id}/diff`)
    ).text();
    expect(html).toContain("AI triage");
  });
});
