import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubRunner } from "../test-runner.ts";

/** Default-branch verification (#910) is on by default; a project admin turns it off (API and form). */
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

type Row = { slug: string; requireVerifiedDefault?: boolean };

describe("project requireVerifiedDefault setting", () => {
  it("is documented in the OpenAPI schemas, and the build schema carries the host's answer", async () => {
    const { app } = boot();
    const doc = (await (await app.request("/api/v1/openapi.json")).json()) as {
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
    };
    for (const name of ["Project", "ProjectCreateInput", "ProjectUpdateInput"]) {
      expect(doc.components.schemas[name]?.properties).toHaveProperty("requireVerifiedDefault");
    }
    expect(doc.components.schemas["Build"]?.properties).toHaveProperty("branchVerified");
  });

  it("can be turned off at creation", async () => {
    const { json } = boot();
    const created = (await (
      await json("POST", "/projects", { name: "Off", requireVerifiedDefault: false })
    ).json()) as Row;
    expect(created.requireVerifiedDefault).toBe(false);
  });

  it("shows the toggle checked on the Capture & tests tab and saves it from the form", async () => {
    const { app, json } = boot();
    const created = (await (await json("POST", "/projects", { name: "Form" })).json()) as Row;
    const tab = `/projects/${created.slug}/settings/capture`;
    expect(await (await app.request(tab)).text()).toMatch(
      /name="requireVerifiedDefault"[^>]*checked/u,
    );

    const save = async (fields: Record<string, string>) =>
      await app.request(`/projects/${created.slug}/settings/tests`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-csrf-token": getCsrfToken(),
        },
        body: new URLSearchParams({ playTimeoutMs: "10000", ...fields }).toString(),
      });
    expect([200, 204, 302]).toContain((await save({})).status);
    const off = (await (await json("GET", `/projects/${created.slug}`)).json()) as Row;
    expect(off.requireVerifiedDefault).toBe(false);

    expect([200, 204, 302]).toContain((await save({ requireVerifiedDefault: "true" })).status);
    const on = (await (await json("GET", `/projects/${created.slug}`)).json()) as Row;
    expect(on.requireVerifiedDefault).toBe(true);
  });
});
