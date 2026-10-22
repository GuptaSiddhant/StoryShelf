import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubRunner } from "../test-runner.ts";

/** Accessibility checks are on by default and a project admin can switch them off (API and form). */
function boot() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    testing: { runner: stubRunner() },
  });
  const json = async (method: string, path: string, body?: unknown) =>
    await app.request(`/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { app, json };
}

describe("project runA11y setting", () => {
  it("is documented in the OpenAPI schemas of create, read and patch", async () => {
    const { app } = boot();
    const doc = (await (await app.request("/api/v1/openapi.json")).json()) as {
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
    };
    for (const name of ["Project", "ProjectCreateInput", "ProjectUpdateInput"]) {
      expect(doc.components.schemas[name]?.properties).toHaveProperty("runA11y");
    }
    expect(doc.components.schemas["Snapshot"]?.properties).toHaveProperty("a11yViolations");
  });

  it("can be set at creation and patched through the API", async () => {
    const { json } = boot();
    const created = (await (
      await json("POST", "/projects", { name: "Axe", runA11y: false })
    ).json()) as {
      slug: string;
      runA11y?: boolean;
    };
    expect(created.runA11y).toBe(false);
    const patched = await json("PATCH", `/projects/${created.slug}`, { runA11y: true });
    expect(((await patched.json()) as { runA11y?: boolean }).runA11y).toBe(true);
    const read = await json("GET", `/projects/${created.slug}`);
    expect(((await read.json()) as { runA11y?: boolean }).runA11y).toBe(true);
    expect((await json("PATCH", `/projects/${created.slug}`, { runA11y: "no" })).status).toBe(400);
  });

  it("shows the toggle checked on the Tests tab and saves it from the form", async () => {
    const { app, json } = boot();
    const created = (await (await json("POST", "/projects", { name: "Axe form" })).json()) as {
      slug: string;
    };
    const tab = `/projects/${created.slug}/settings/tests`;
    const page = await (await app.request(tab)).text();
    expect(page).toMatch(/name="runA11y"[^>]*checked/u);

    const saved = await app.request(tab, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": getCsrfToken(),
      },
      body: new URLSearchParams({ playTimeoutMs: "10000" }).toString(),
    });
    expect([200, 204, 302]).toContain(saved.status);
    const after = (await (await json("GET", `/projects/${created.slug}`)).json()) as {
      runA11y?: boolean;
    };
    expect(after.runA11y).toBe(false);
    expect(await (await app.request(tab)).text()).not.toMatch(/name="runA11y"[^>]*checked/u);
  });
});
