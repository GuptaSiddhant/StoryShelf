import type { CaptureRunner, RunnerTarget } from "@storyshelf/core/adapter/capture-runner";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubRunner } from "../test-runner.ts";

const TARGETS: RunnerTarget[] = [
  { target: "chromium", reach: "loopback", status: "ready" },
  { target: "firefox", reach: "loopback", status: { unavailable: "declared, not installed" } },
  { target: "chromium@grid", reach: "url", status: "ready" },
];

function runnerOffering(targets: RunnerTarget[]): CaptureRunner {
  const base = stubRunner();
  return { ...base, metadata: { ...base.metadata, targets } };
}

async function setup(config: Record<string, unknown> = {}, browsers: string | null = null) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Targets",
    slug: "targets",
    gitRepository: null,
    gitDefaultBranch: "main",
    browsers,
    createdAt: now,
    updatedAt: now,
  });
  const app = createShelfApp({
    testing: { runner: runnerOffering(TARGETS) },
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config,
  });
  const patch = async (body: unknown) =>
    await app.request("/api/v1/projects/targets", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const save = async (fields: Record<string, string>) =>
    await app.request("/projects/targets/settings/capture", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": getCsrfToken(config["secret"] as string | undefined),
      },
      body: new URLSearchParams(fields).toString(),
    });
  return { app, patch, save };
}

describe("saving capture targets against what the runner offers", () => {
  it("refuses an unavailable target with the reason, and one the runner does not offer", async () => {
    const { patch } = await setup();
    const unavailable = await patch({ browsers: ["chromium", "firefox"] });
    expect(unavailable.status).toBe(400);
    expect(await unavailable.text()).toContain("firefox is unavailable: declared, not installed");
    const missing = await patch({ browser: "webkit" });
    expect(missing.status).toBe(400);
    expect(await missing.text()).toContain("webkit is not offered by this capture runner");
  });

  it("refuses a target that needs a URL until a public origin and a secret exist", async () => {
    const { patch } = await setup();
    expect(await (await patch({ browser: "chromium@grid" })).text()).toContain("no secret");
    const withSecret = await setup({ secret: "targets-secret" });
    expect(await (await withSecret.patch({ browser: "chromium@grid" })).text()).toContain(
      "no public origin",
    );
    const ready = await setup({
      secret: "targets-secret",
      publicBaseUrl: "https://shelf.example.com",
    });
    expect((await ready.patch({ browsers: ["chromium", "chromium@grid"] })).status).toBe(200);
  });

  it("rejects a malformed target at the schema", async () => {
    const { patch } = await setup();
    expect((await patch({ browser: "chromium@Grid" })).status).toBe(400);
    expect((await patch({ browsers: ["safari"] })).status).toBe(400);
  });

  it("does not refuse a target the project already has when it is saved again", async () => {
    const { patch } = await setup({}, '["firefox"]');
    expect((await patch({ browsers: ["firefox"] })).status).toBe(200);
  });

  it("applies the same refusal to the capture settings form", async () => {
    const { save, app } = await setup();
    const refused = await save({ browser: "chromium", extra_firefox: "firefox" });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("firefox is unavailable");
    expect((await save({ browser: "chromium" })).status).toBeLessThan(400);
    const page = await (await app.request("/projects/targets/settings/capture")).text();
    expect(page).toContain("firefox: declared, not installed; chromium@grid: no secret");
    expect(page).not.toContain('name="extra_firefox"');
  });

  it("applies it to the general settings select too", async () => {
    const { app } = await setup();
    const response = await app.request("/projects/targets/settings", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": getCsrfToken(),
      },
      body: new URLSearchParams({ name: "Targets", browser: "firefox" }).toString(),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("firefox is unavailable");
  });
});

describe("the System page lists the targets", () => {
  it("shows each target with its status and reason", async () => {
    const { app } = await setup();
    const html = await (await app.request("/admin")).text();
    expect(html).toContain("Capture browsers");
    expect(html).toContain("chromium@grid");
    expect(html).toContain("declared, not installed");
    expect(html).toContain("signed URL");
  });
});
