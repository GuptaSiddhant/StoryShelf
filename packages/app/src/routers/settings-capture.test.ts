import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";

async function setup() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Capture Project",
    slug: "capture-project",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  const app = createShelfApp({ database: db, storage, logger: pino({ level: "silent" }) });
  const save = async (fields: Record<string, string>) =>
    await app.request("/projects/capture-project/settings/capture", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": getCsrfToken(),
      },
      body: new URLSearchParams(fields).toString(),
    });
  const project = async () =>
    (await (await app.request("/api/v1/projects/capture-project")).json()) as {
      browser?: string;
      browsers?: string | null;
      modesAllowlist?: string | null;
    };
  return { app, save, project };
}

describe("capture settings tab", () => {
  it("renders the browser controls and the allowlist", async () => {
    const { app } = await setup();
    const page = await app.request("/projects/capture-project/settings/capture");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Primary browser");
    expect(html).toContain('name="extra_firefox"');
    expect(html).toContain('name="modesAllowlist"');
    expect(html).toContain(">Capture<");
  });

  it("saves a primary engine plus extras and the mode allowlist", async () => {
    const { save, project } = await setup();
    const response = await save({
      browser: "chromium",
      extra_firefox: "firefox",
      extra_webkit: "webkit",
      modesAllowlist: "dark\n  mobile \n\n",
    });
    expect([204, 302]).toContain(response.status);
    expect(await project()).toMatchObject({
      browser: "chromium",
      browsers: '["chromium","firefox","webkit"]',
      modesAllowlist: '["dark","mobile"]',
    });
  });

  it("a single engine clears the list and an empty allowlist clears the filter", async () => {
    const { save, project } = await setup();
    await save({ browser: "chromium", extra_firefox: "firefox", modesAllowlist: "dark" });
    await save({ browser: "webkit", modesAllowlist: "" });
    expect(await project()).toMatchObject({
      browser: "webkit",
      browsers: null,
      modesAllowlist: null,
    });
  });

  it("rejects more than three engines and unusable mode names", async () => {
    const { save, project } = await setup();
    const tooMany = await save({
      browser: "chromium",
      extra_firefox: "firefox",
      extra_webkit: "webkit",
      extra_chrome: "chrome",
    });
    expect(tooMany.status).toBe(400);
    expect(await tooMany.text()).toContain("at most 3");

    const badMode = await save({ browser: "chromium", modesAllowlist: "***" });
    expect(badMode.status).toBe(400);
    expect(await badMode.text()).toContain("Invalid mode name");
    expect((await project()).browsers ?? null).toBeNull();
  });
});
