import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { AuthUser } from "@storyshelf/core/types";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { CROSS_SITE_WRITE_MESSAGE } from "../middleware/same-site-writes.ts";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";
import { listRegisteredRoutes, type RegisteredRoute } from "./enumerate.ts";
import { CSRF_PATHS, ORIGIN_ONLY_WRITES, WRITE_METHODS } from "./write-protection.ts";

type App = ReturnType<typeof createShelfApp>;

const ADMIN: AuthUser = { id: "admin_1", email: "a@example.com", name: "A", role: "admin" };
const SESSION = "session-786";
const COOKIE = `storyshelf_session=${SESSION}`;
const PORTAL = "http://localhost";
const TOKEN = getCsrfToken(undefined, SESSION);

const apps: App[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
});

/** Boots with auth (a signed-in admin) and testing, so every write route registers and is reachable. */
function boot(): App {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({
    database: db,
    storage,
    auth: stubAuth(ADMIN),
    testing: { runner: stubRunner() },
  });
  apps.push(app);
  return app;
}

/** A request path for a Hono pattern: every parameter and wildcard becomes a placeholder. */
function concretePath(pattern: string): string {
  return pattern.replaceAll(/:[A-Za-z]+/gu, "x").replaceAll("*", "x");
}

const keyOf = (route: RegisteredRoute): string => `${route.method} ${route.path}`;

/** Every registered state-changing route; the auth engine's `app.all` counts as a write. */
function writeRoutes(app: App): RegisteredRoute[] {
  return listRegisteredRoutes(app).filter(
    (route) => WRITE_METHODS.has(route.method) || route.method === "ALL",
  );
}

/** Page (form) writes: everything outside `/api/`. */
const isPageWrite = (route: RegisteredRoute): boolean => !route.path.startsWith("/api/");

async function send(app: App, route: RegisteredRoute, headers: Record<string, string>) {
  return await app.request(concretePath(route.path), {
    method: route.method === "ALL" ? "POST" : route.method,
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: COOKIE, ...headers },
    body: "",
  });
}

/** Whether the answer is the CSRF middleware's own refusal. */
async function isTokenRefusal(response: Response): Promise<boolean> {
  return response.status === 403 && (await response.clone().text()).includes("Invalid CSRF token");
}

/** The paths a Hono `use` pattern matches, judged by Hono's own router. */
async function guardedPaths(pattern: string, paths: readonly string[]): Promise<string[]> {
  const probe = new Hono();
  probe.use(pattern, async (c) => c.text("guarded", 403));
  probe.all("*", (c) => c.text("open"));
  const hits = await Promise.all(
    paths.map(async (path) =>
      (await probe.request(path, { method: "POST" })).status === 403 ? path : undefined,
    ),
  );
  return hits.filter((path) => path !== undefined);
}

/** Routes whose cookie-carrying request is not refused (403 with the same-origin message). */
async function acceptedCrossSite(headers: Record<string, string>): Promise<string[]> {
  const app = boot();
  const outcomes = await Promise.all(
    writeRoutes(app).map(async (route) => {
      // A valid token, so the token check passes and the same-origin rule alone decides.
      const response = await send(app, route, { "x-csrf-token": TOKEN, ...headers });
      const refused =
        response.status === 403 && (await response.text()).includes(CROSS_SITE_WRITE_MESSAGE);
      return refused ? undefined : `${keyOf(route)} -> ${String(response.status)}`;
    }),
  );
  return outcomes.filter((outcome) => outcome !== undefined);
}

describe("write protection matrix (#786)", () => {
  it("guards every page write with a CSRF token, unless it is listed as origin-only", async () => {
    const app = boot();
    const pageWrites = writeRoutes(app).filter(
      (route) => isPageWrite(route) && !(keyOf(route) in ORIGIN_ONLY_WRITES),
    );
    expect(pageWrites.length).toBeGreaterThan(40);
    const outcomes = await Promise.all(
      pageWrites.map(async (route) => {
        const response = await send(app, route, { "sec-fetch-site": "same-origin" });
        return (await isTokenRefusal(response)) ? undefined : keyOf(route);
      }),
    );
    expect(
      outcomes.filter((key) => key !== undefined),
      "add the path to CSRF_PATHS in routes/write-protection.ts (and csrfField() to its form)",
    ).toEqual([]);
  });

  it("lists only registered, token-less page writes as origin-only", async () => {
    const app = boot();
    const byKey = new Map(writeRoutes(app).map((route) => [keyOf(route), route]));
    const stale = await Promise.all(
      Object.keys(ORIGIN_ONLY_WRITES).map(async (key) => {
        const route = byKey.get(key);
        if (!route || !isPageWrite(route)) {
          return key;
        }
        const response = await send(app, route, { "sec-fetch-site": "same-origin" });
        return (await isTokenRefusal(response)) ? key : undefined;
      }),
    );
    expect(stale.filter((key) => key !== undefined)).toEqual([]);
  });

  it("has no CSRF_PATHS pattern that guards no registered write", async () => {
    const paths = writeRoutes(boot()).map((route) => concretePath(route.path));
    const idle = await Promise.all(
      CSRF_PATHS.map(async (pattern) => {
        const guarded = await guardedPaths(pattern, paths);
        return guarded.length === 0 ? pattern : undefined;
      }),
    );
    expect(idle.filter((pattern) => pattern !== undefined)).toEqual([]);
  });

  it("refuses every cookie-carrying write from another site, even with a valid CSRF token", async () => {
    const accepted = await acceptedCrossSite({
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    });
    expect(accepted).toEqual([]);
  });

  it("refuses every cookie-carrying write from a sibling host of the same site", async () => {
    const accepted = await acceptedCrossSite({
      origin: "http://build.localhost",
      "sec-fetch-site": "same-site",
    });
    expect(accepted).toEqual([]);
  });

  it("refuses a cross-site write that carries the cookie beside a bearer token", async () => {
    const accepted = await acceptedCrossSite({
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
      authorization: "Bearer not-a-token",
    });
    expect(accepted).toEqual([]);
  });
});

/** `POST /api/v1/projects` with the admin's session cookie, from the portal. */
const create = async (app: App, headers: Record<string, string>): Promise<Response> =>
  await app.request("/api/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: COOKIE, origin: PORTAL, ...headers },
    body: JSON.stringify({ name: "Bearer Probe" }),
  });

describe("bearer requests never ride the session cookie (#786)", () => {
  it("lets the signed-in admin write from the portal", async () => {
    expect((await create(boot(), {})).status).toBe(201);
  });

  it("ignores the session once an Authorization header is present, so a bad token is refused", async () => {
    const app = boot();
    expect((await create(app, { authorization: "Bearer not-a-token" })).status).toBe(403);
    expect((await create(app, { authorization: "Basic YTpi" })).status).toBe(403);
  });
});
