import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";

async function seed() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Browser Project",
    slug: "browser-project",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  return { db, storage };
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

describe("general settings capture browser", () => {
  it("renders the browser select defaulting to chromium", async () => {
    const { db, storage } = await seed();
    const app = createShelfApp({ database: db, storage, logger: pino({ level: "silent" }) });

    const page = await app.request("/projects/browser-project/settings");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('name="browser"');
    expect(html).toContain('value="chromium" selected');
  });

  it("persists a valid browser from the general form", async () => {
    const { db, storage } = await seed();
    const app = createShelfApp({ database: db, storage, logger: pino({ level: "silent" }) });

    const saved = await app.request(
      "/projects/browser-project/settings",
      postForm({ name: "Browser Project", browser: "firefox" }),
    );
    expect([204, 302]).toContain(saved.status);

    const project = await app.request("/api/v1/projects/browser-project");
    expect(project.status).toBe(200);
    expect((await project.json()) as { browser?: string }).toMatchObject({
      browser: "firefox",
    });

    const page = await app.request("/projects/browser-project/settings");
    expect(await page.text()).toContain('value="firefox" selected');
  });

  it("rejects an unknown browser from the general form", async () => {
    const { db, storage } = await seed();
    const app = createShelfApp({ database: db, storage, logger: pino({ level: "silent" }) });

    const saved = await app.request(
      "/projects/browser-project/settings",
      postForm({ name: "Browser Project", browser: "netscape" }),
    );
    expect(saved.status).toBe(400);
  });

  it("accepts browser through the projects PATCH API and rejects unknown values", async () => {
    const { db, storage } = await seed();
    const app = createShelfApp({ database: db, storage, logger: pino({ level: "silent" }) });
    const jsonHeaders = { "content-type": "application/json" };

    const updated = await app.request("/api/v1/projects/browser-project", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ browser: "webkit" }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()) as { browser?: string }).toMatchObject({
      browser: "webkit",
    });

    const rejected = await app.request("/api/v1/projects/browser-project", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ browser: "netscape" }),
    });
    expect(rejected.status).toBe(400);
  });
});
