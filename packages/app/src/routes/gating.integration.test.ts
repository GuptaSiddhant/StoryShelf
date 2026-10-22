import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { afterEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { REVIEW_DISABLED_MESSAGE } from "../middleware/require-review.ts";
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

describe("review gate", () => {
  const SECRET = "gate-test-secret";

  /** Two projects: `off` has review off, `on` keeps the default. */
  async function bootProjects(): Promise<App> {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const now = "2026-01-01T00:00:00.000Z";
    await Promise.all(
      (
        [
          ["off", false],
          ["on", true],
        ] as const
      ).map(
        async ([slug, reviewEnabled]) =>
          await db.insert(db.tables.projects, {
            id: slug,
            name: slug,
            slug,
            gitRepository: null,
            gitDefaultBranch: "main",
            reviewEnabled,
            reviewApprovals: 1,
            createdAt: now,
            updatedAt: now,
          }),
      ),
    );
    const app = createShelfApp({ database: db, storage, config: { secret: SECRET } });
    apps.push(app);
    await app.lifecycle.setup();
    return app;
  }

  async function refusedBy(
    app: App,
    slug: string,
  ): Promise<{ refused: string[]; passed: string[] }> {
    const routes = listRegisteredRoutes(app).filter(
      ({ method, path }) => classOfRoute(method, path) === "review",
    );
    const outcomes = await Promise.all(
      routes.map(async ({ method, path }) => {
        const response = await app.request(concretePath(path).replace("/x/", `/${slug}/`), {
          method,
          headers: {
            "content-type": "application/json",
            "x-csrf-token": getCsrfToken(SECRET, "default"),
          },
          ...(method === "GET" ? {} : { body: "{}" }),
        });
        const refused =
          response.status === 404 &&
          (await response.clone().text()).includes(REVIEW_DISABLED_MESSAGE);
        return { key: `${method} ${path}`, refused };
      }),
    );
    return {
      refused: outcomes.filter((outcome) => outcome.refused).map((outcome) => outcome.key),
      passed: outcomes.filter((outcome) => !outcome.refused).map((outcome) => outcome.key),
    };
  }

  it("answers 404 on every review route, API and page, for a project with review off", async () => {
    const app = await bootProjects();
    const off = await refusedBy(app, "off");
    expect(off.passed, "review routes the gate let through").toEqual([]);
    // Comments (3), verdicts (2), changeset (1) and the three page forms.
    expect(off.refused).toHaveLength(9);
  });

  it("lets every review route through for a project with review on", async () => {
    const app = await bootProjects();
    const on = await refusedBy(app, "on");
    expect(on.refused).toEqual([]);
    expect(on.passed).toHaveLength(9);
  });

  it("leaves routes of the other classes alone when review is off", async () => {
    const app = await bootProjects();
    const paths = ["/api/v1/projects/off", "/projects/off", "/projects/off/builds"];
    const bodies = await Promise.all(
      paths.map(async (path) => await (await app.request(path)).text()),
    );
    for (const body of bodies) {
      expect(body).not.toContain(REVIEW_DISABLED_MESSAGE);
    }
  });
});
