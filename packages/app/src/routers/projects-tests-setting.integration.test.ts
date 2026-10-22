import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubRunner } from "../test-runner.ts";

/** Storybook `.test()` runs are off by default; a project admin switches them on (API and form). */
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

describe("project runTests setting", () => {
  it("is documented in the OpenAPI schemas, and the build schema carries the results", async () => {
    const { app } = boot();
    const doc = (await (await app.request("/api/v1/openapi.json")).json()) as {
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
    };
    for (const name of ["Project", "ProjectCreateInput", "ProjectUpdateInput"]) {
      expect(doc.components.schemas[name]?.properties).toHaveProperty("runTests");
    }
    expect(doc.components.schemas["Build"]?.properties).toHaveProperty("testResults");
  });

  it("is off by default, and can be set at creation and patched through the API", async () => {
    const { json } = boot();
    const plain = (await (await json("POST", "/projects", { name: "Plain" })).json()) as {
      runTests?: boolean;
    };
    expect(plain.runTests ?? false).toBe(false);
    const created = (await (
      await json("POST", "/projects", { name: "Tests", runTests: true })
    ).json()) as { slug: string; runTests?: boolean };
    expect(created.runTests).toBe(true);
    const patched = await json("PATCH", `/projects/${created.slug}`, { runTests: false });
    expect(((await patched.json()) as { runTests?: boolean }).runTests).toBe(false);
    expect((await json("PATCH", `/projects/${created.slug}`, { runTests: "no" })).status).toBe(400);
  });

  it("shows the toggle unchecked on the Tests tab and saves it from the form", async () => {
    const { app, json } = boot();
    const created = (await (await json("POST", "/projects", { name: "Tests form" })).json()) as {
      slug: string;
    };
    const tab = `/projects/${created.slug}/settings/tests`;
    expect(await (await app.request(tab)).text()).toMatch(/name="runTests"(?![^>]*checked)/u);

    const save = async (fields: Record<string, string>) =>
      await app.request(tab, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-csrf-token": getCsrfToken(),
        },
        body: new URLSearchParams({ playTimeoutMs: "10000", ...fields }).toString(),
      });
    expect([200, 204, 302]).toContain((await save({ runTests: "true" })).status);
    const on = (await (await json("GET", `/projects/${created.slug}`)).json()) as {
      runTests?: boolean;
    };
    expect(on.runTests).toBe(true);
    expect(await (await app.request(tab)).text()).toMatch(/name="runTests"[^>]*checked/u);

    expect([200, 204, 302]).toContain((await save({})).status);
    const off = (await (await json("GET", `/projects/${created.slug}`)).json()) as {
      runTests?: boolean;
    };
    expect(off.runTests).toBe(false);
  });
});
