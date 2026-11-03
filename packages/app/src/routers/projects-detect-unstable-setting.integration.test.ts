import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubRunner } from "../test-runner.ts";

/** Unstable-render detection is on by default; a project admin turns it off (API and form). */
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

type Row = { slug: string; detectUnstable?: boolean };

describe("project detectUnstable setting", () => {
  it("is documented in the OpenAPI schemas, and the snapshot schema carries the flag", async () => {
    const { app } = boot();
    const doc = (await (await app.request("/api/v1/openapi.json")).json()) as {
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
    };
    for (const name of ["Project", "ProjectCreateInput", "ProjectUpdateInput"]) {
      expect(doc.components.schemas[name]?.properties).toHaveProperty("detectUnstable");
    }
    expect(doc.components.schemas["Snapshot"]?.properties).toHaveProperty("unstable");
  });

  it("is on by default, and can be set at creation and patched through the API", async () => {
    const { json } = boot();
    const plain = (await (await json("POST", "/projects", { name: "Plain" })).json()) as Row;
    expect(plain.detectUnstable ?? true).toBe(true);
    const created = (await (
      await json("POST", "/projects", { name: "Off", detectUnstable: false })
    ).json()) as Row;
    expect(created.detectUnstable).toBe(false);
    const back = await json("PATCH", `/projects/${created.slug}`, { detectUnstable: true });
    expect(((await back.json()) as Row).detectUnstable).toBe(true);
    expect(
      (await json("PATCH", `/projects/${created.slug}`, { detectUnstable: "no" })).status,
    ).toBe(400);
  });

  it("shows the toggle checked on the Tests tab and saves it from the form", async () => {
    const { app, json } = boot();
    const created = (await (await json("POST", "/projects", { name: "Form" })).json()) as Row;
    const tab = `/projects/${created.slug}/settings/tests`;
    expect(await (await app.request(tab)).text()).toMatch(/name="detectUnstable"[^>]*checked/u);

    const save = async (fields: Record<string, string>) =>
      await app.request(tab, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-csrf-token": getCsrfToken(),
        },
        body: new URLSearchParams({ playTimeoutMs: "10000", ...fields }).toString(),
      });
    expect([200, 204, 302]).toContain((await save({})).status);
    const off = (await (await json("GET", `/projects/${created.slug}`)).json()) as Row;
    expect(off.detectUnstable).toBe(false);
    expect(await (await app.request(tab)).text()).toMatch(/name="detectUnstable"(?![^>]*checked)/u);

    expect([200, 204, 302]).toContain((await save({ detectUnstable: "true" })).status);
    const on = (await (await json("GET", `/projects/${created.slug}`)).json()) as Row;
    expect(on.detectUnstable).toBe(true);
  });
});
