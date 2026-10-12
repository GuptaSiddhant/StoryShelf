import { PackageUsageModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";

async function seed() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await Promise.all(
    [
      ["app", "web-app"],
      ["ds", "design-system"],
    ].map(async ([id, slug]) => {
      await db.insert(db.tables.projects, {
        id,
        name: slug,
        slug,
        gitRepository: null,
        gitDefaultBranch: "main",
        createdAt: now,
        updatedAt: now,
      } as never);
    }),
  );
  const app = createShelfApp({ database: db, storage, logger: pino({ level: "silent" }) });
  return { db, app };
}

function postForm(body: Record<string, string>) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-csrf-token": getCsrfToken(),
    },
    body: new URLSearchParams(body).toString(),
  } as const;
}

describe("link settings", () => {
  it("renders the Links tab with upstream choices excluding the project itself", async () => {
    const { app } = await seed();
    const html = await (await app.request("/projects/web-app/settings/links")).text();
    expect(html).toContain("Linked packages");
    expect(html).toContain('value="design-system"');
    expect(html).not.toContain('value="web-app"');
    expect(html).toContain("No packages linked.");
  });

  it("links a package, replaces an existing link for it, and unlinks it", async () => {
    const { app, db } = await seed();
    const model = new PackageUsageModel(db);
    const add = await app.request(
      "/projects/web-app/settings/links",
      postForm({ package: "@acme/ds", upstreamSlug: "design-system" }),
    );
    expect([204, 302]).toContain(add.status);
    expect(await model.listLinks("app")).toMatchObject([
      { packageName: "@acme/ds", upstreamId: "ds" },
    ]);
    const page = await (await app.request("/projects/web-app/settings/links")).text();
    expect(page).toContain("@acme/ds");

    await app.request(
      "/projects/web-app/settings/links",
      postForm({ package: "@acme/ds", upstreamSlug: "design-system" }),
    );
    expect(await model.listLinks("app")).toHaveLength(1);

    const removed = await app.request(
      "/projects/web-app/settings/links/delete",
      postForm({ package: "@acme/ds" }),
    );
    expect([204, 302]).toContain(removed.status);
    expect(await model.listLinks("app")).toEqual([]);
  });

  it("rejects a missing package, an unknown upstream, and a self link", async () => {
    const { app, db } = await seed();
    const forms = [
      { package: "", upstreamSlug: "design-system" },
      { package: "@acme/ds", upstreamSlug: "nope" },
      { package: "@acme/ds", upstreamSlug: "web-app" },
    ];
    const statuses = await Promise.all(
      forms.map(
        async (form) =>
          (await app.request("/projects/web-app/settings/links", postForm(form))).status,
      ),
    );
    expect(statuses).toEqual([400, 400, 400]);
    expect(await new PackageUsageModel(db).listLinks("app")).toEqual([]);
  });
});
