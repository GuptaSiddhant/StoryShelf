import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { afterEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { TESTING_DISABLED_MESSAGE } from "../middleware/require-testing.ts";
import { stubRunner } from "../test-runner.ts";
import { classOfRoute } from "./classification.ts";
import { listRegisteredRoutes } from "./enumerate.ts";

type App = ReturnType<typeof createShelfApp>;

const apps: App[] = [];

function boot(withTesting: boolean): App {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({
    database: db,
    storage,
    ...(withTesting ? { testing: { runner: stubRunner() } } : {}),
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
});

/** A request path for a Hono pattern: every parameter and wildcard becomes a placeholder. */
function concretePath(pattern: string): string {
  return pattern.replaceAll(/:[A-Za-z]+/gu, "x").replaceAll("*", "x");
}

/** Whether the response is the gate's own 404 (a handler's 404, e.g. unknown project, is not). */
async function isGateRefusal(response: Response): Promise<boolean> {
  return (
    response.status === 404 && (await response.clone().text()).includes(TESTING_DISABLED_MESSAGE)
  );
}

async function gateRefusals(
  app: App,
  wanted: (routeClass: string | undefined) => boolean,
): Promise<{ refused: string[]; passed: string[] }> {
  const routes = listRegisteredRoutes(app).filter(({ method, path }) =>
    wanted(classOfRoute(method, path)),
  );
  const outcomes = await Promise.all(
    routes.map(async ({ method, path }) => {
      const response = await app.request(concretePath(path), {
        method,
        ...(method === "GET"
          ? {}
          : { headers: { "content-type": "application/json" }, body: "{}" }),
      });
      return { key: `${method} ${path}`, refused: await isGateRefusal(response) };
    }),
  );
  return {
    refused: outcomes.filter((outcome) => outcome.refused).map((outcome) => outcome.key),
    passed: outcomes.filter((outcome) => !outcome.refused).map((outcome) => outcome.key),
  };
}

describe("testing gate", () => {
  it("testing routes 404 without `testing`, hosting routes don't", async () => {
    const app = boot(false);
    await app.lifecycle.setup();

    const testing = await gateRefusals(app, (routeClass) => routeClass === "testing");
    expect(testing.passed, "testing routes the gate let through").toEqual([]);
    expect(testing.refused.length).toBeGreaterThan(30);

    const others = await gateRefusals(app, (routeClass) => routeClass !== "testing");
    expect(others.refused, "routes the gate must not touch").toEqual([]);
    expect(others.passed.length).toBeGreaterThan(70);
  });

  it("lets testing routes through when `testing` is set", async () => {
    const app = boot(true);
    await app.lifecycle.setup();

    const testing = await gateRefusals(app, (routeClass) => routeClass === "testing");
    expect(testing.refused).toEqual([]);
    expect(testing.passed.length).toBeGreaterThan(30);
  });

  it("answers JSON on API routes and plain text on pages", async () => {
    const app = boot(false);
    await app.lifecycle.setup();

    const api = await app.request("/api/v1/projects/demo/builds/b1/snapshots");
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: TESTING_DISABLED_MESSAGE });
    const page = await app.request("/projects/demo/jobs");
    expect(page.status).toBe(404);
    expect(await page.text()).toBe(TESTING_DISABLED_MESSAGE);
  });

  it("keeps the unclassified paths on their own 404", async () => {
    const app = boot(false);
    await app.lifecycle.setup();

    const response = await app.request("/no-such-page");
    expect(response.status).toBe(404);
    expect(await isGateRefusal(response)).toBe(false);
  });
});
