import { READ_ONLY_ACCOUNT_MESSAGE, readOnlyAccountMatcher } from "@storyshelf/core/auth";
import { ProjectModel, TokenModel, UserModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { AuthUser } from "@storyshelf/core/types";
import { sha256 } from "@storyshelf/core/utils";
import { afterEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { listRegisteredRoutes, type RegisteredRoute } from "../routes/enumerate.ts";
import { WRITE_METHODS } from "../routes/write-protection.ts";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";
import { getCsrfToken } from "./csrf.ts";

type App = ReturnType<typeof createShelfApp>;

/**
 * The shared account, a site admin on purpose: every refusal below must come from the read-only
 * rule, not from a role check (the assertions match the read-only message exactly).
 */
const DEMO: AuthUser = {
  id: "user_demo",
  email: "Demo@Example.test",
  name: "Demo",
  role: "admin",
  readOnly: true,
};
const OTHER: AuthUser = { id: "user_ada", email: "ada@example.test", name: "Ada", role: "admin" };
const SESSION = "session-1274";
const COOKIE = `storyshelf_session=${SESSION}`;
const CSRF = getCsrfToken(undefined, SESSION);
const TOKEN = "shelf_demo-token-1274";
const isReadOnlyAccount = readOnlyAccountMatcher(["demo@example.test"]);

/** The writes a read-only account may still make. */
const ALLOWED = new Set(["POST /auth/logout", "POST /auth/engine/login"]);

const apps: App[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
});

/**
 * An app with auth and testing (so every write registers), whose session resolves to `user` and
 * whose bearer token `TOKEN` is owned by the demo account.
 */
async function boot(user: AuthUser | null, cookieUser: AuthUser | null = user): Promise<App> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({
    database: db,
    storage,
    // `check` resolves the cookie; the store skips it when an Authorization header is present.
    auth: stubAuth(user, {
      isReadOnlyAccount,
      check: async () => await Promise.resolve(cookieUser),
    }),
    testing: { runner: stubRunner() },
  });
  apps.push(app);
  await new UserModel(db).upsert({ ...DEMO, role: "admin" });
  const project = await new ProjectModel(db).create({ name: "Demo" });
  await new TokenModel(db).create(project.id, {
    name: "demo",
    hash: sha256(TOKEN),
    userId: DEMO.id,
  });
  return app;
}

/** A request path for a Hono pattern: every parameter and wildcard becomes a placeholder. */
function concretePath(pattern: string): string {
  return pattern.replaceAll(/:[A-Za-z]+/gu, "x").replaceAll("*", "x");
}

const keyOf = (route: RegisteredRoute): string => `${route.method} ${route.path}`;

/** The reads that change state, refused like writes (the connection flow stores provider tokens). */
const REFUSED_READS = new Set([
  "GET /connections/:service/start",
  "GET /connections/:service/callback",
]);

/**
 * Every registered state-changing route, plus the reads that write; the auth engine's `app.all`
 * counts as a write.
 */
function writeRoutes(app: App): RegisteredRoute[] {
  return listRegisteredRoutes(app).filter(
    (route) =>
      WRITE_METHODS.has(route.method) || route.method === "ALL" || REFUSED_READS.has(keyOf(route)),
  );
}

async function send(
  app: App,
  route: RegisteredRoute,
  headers: Record<string, string>,
): Promise<Response> {
  const method = route.method === "ALL" ? "POST" : route.method;
  return await app.request(concretePath(route.path), {
    method,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "sec-fetch-site": "same-origin",
      "x-csrf-token": CSRF,
      ...headers,
    },
    ...(method === "GET" ? {} : { body: "" }),
  });
}

async function isReadOnlyRefusal(response: Response): Promise<boolean> {
  return response.status === 403 && (await response.text()).includes(READ_ONLY_ACCOUNT_MESSAGE);
}

/** The write routes outside `ALLOWED` that are answered other than with the read-only refusal. */
async function notRefused(app: App, headers: Record<string, string>): Promise<string[]> {
  const routes = writeRoutes(app).filter((route) => !ALLOWED.has(keyOf(route)));
  expect(routes.length).toBeGreaterThan(40);
  const outcomes = await Promise.all(
    routes.map(async (route) =>
      (await isReadOnlyRefusal(await send(app, route, headers))) ? undefined : keyOf(route),
    ),
  );
  return outcomes.filter((key) => key !== undefined);
}

describe("read-only shared accounts (#1274)", () => {
  it("refuses every classified write route made with the account's session", async () => {
    const app = await boot(DEMO);
    expect(await notRefused(app, { cookie: COOKIE })).toEqual([]);
  });

  it("walks the connection flow's GET start and callback with the writes", async () => {
    const app = await boot(DEMO);
    const walked = writeRoutes(app).map((route) => keyOf(route));
    expect(walked).toEqual(expect.arrayContaining([...REFUSED_READS]));
    for (const path of ["/connections/figma/start", "/connections/figma/callback?code=c&state=s"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- two paths, one after the other
      const response = await app.request(path, { headers: { cookie: COOKIE } });
      // oxlint-disable-next-line eslint/no-await-in-loop -- two paths, one after the other
      expect(await isReadOnlyRefusal(response), path).toBe(true);
    }
  });

  it("still lets the account sign in and sign out", async () => {
    const app = await boot(DEMO);
    const routes = writeRoutes(app).filter((route) => ALLOWED.has(keyOf(route)));
    expect(routes.map((route) => keyOf(route)).toSorted()).toEqual([...ALLOWED].toSorted());
    for (const route of routes) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- two routes, one after the other
      const response = await send(app, route, { cookie: COOKIE });
      // oxlint-disable-next-line eslint/no-await-in-loop -- two routes, one after the other
      expect(await isReadOnlyRefusal(response), keyOf(route)).toBe(false);
    }
  });

  it("refuses every write made with a bearer token the account owns", async () => {
    const app = await boot(null, null);
    // The anonymous CSRF token, so the page routes' token check passes and the read-only rule decides.
    expect(
      await notRefused(app, { authorization: `Bearer ${TOKEN}`, "x-csrf-token": getCsrfToken() }),
    ).toEqual([]);
  });

  it("refuses the session cookie even when an Authorization header rides beside it", async () => {
    const app = await boot(null, DEMO);
    expect(await notRefused(app, { cookie: COOKIE, authorization: "Bearer not-a-token" })).toEqual(
      [],
    );
  });

  it("recognises the account by email even without the flag", async () => {
    const app = await boot({ ...DEMO, readOnly: undefined, email: "demo@example.test" });
    const response = await app.request("/api/v1/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: COOKIE,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(await isReadOnlyRefusal(response)).toBe(true);
  });

  it("refuses a verdict, a comment and a password change with the one message", async () => {
    const app = await boot(DEMO);
    for (const path of [
      "/api/v1/projects/demo/builds/b1/reviews",
      "/api/v1/projects/demo/builds/b1/comments",
      "/profile/password",
      "/api/auth/change-password",
    ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- a few paths in turn
      const response = await app.request(path, {
        method: "POST",
        headers: { cookie: COOKIE, "sec-fetch-site": "same-origin", "x-csrf-token": CSRF },
      });
      // oxlint-disable-next-line eslint/no-await-in-loop -- a few paths in turn
      expect(await isReadOnlyRefusal(response), path).toBe(true);
    }
  });

  it("lets the account read", async () => {
    const app = await boot(DEMO);
    const response = await app.request("/api/v1/projects", { headers: { cookie: COOKIE } });
    expect(response.status).toBe(200);
  });

  it("leaves every other account's writes alone", async () => {
    const app = await boot(OTHER);
    const response = await app.request("/api/v1/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: COOKIE,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ name: "Fine" }),
    });
    expect(response.status).toBe(201);
  });
});
