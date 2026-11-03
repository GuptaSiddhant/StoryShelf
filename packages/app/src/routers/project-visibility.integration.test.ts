import { MemberModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { API_ROUTE_CLASSES } from "../routes/api-routes.ts";
import { PAGE_ROUTE_CLASSES } from "../routes/page-routes.ts";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

/**
 * A caller with no role on a project gets the answer for a project that does not exist (404), on
 * every project-scoped route; 403 is only for a caller who can see the project but lacks the role.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const users = ["admin", "viewer", "outsider"].map((id) => ({
  id,
  email: `${id}@example.com`,
  name: id,
  role: id === "admin" ? ("admin" as const) : ("member" as const),
}));
const auth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    const id = /storyshelf_session=(?<id>\w+)/u.exec(cookie)?.groups?.["id"];
    return await Promise.resolve(users.find((user) => user.id === id) ?? null);
  },
});

let scratchDir = "";
let booted: { lifecycle: { teardown: () => Promise<void> } } | undefined;
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-visibility-"));
});
afterEach(async () => {
  await booted?.lifecycle.teardown();
  booted = undefined;
  await rm(scratchDir, { recursive: true, force: true });
});

async function boot() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Hidden",
    slug: "hidden",
    gitRepository: "acme/widgets",
    gitDefaultBranch: "main",
    reviewEnabled: true,
    reviewApprovals: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await Promise.all(
    users.map(async (user) => {
      await db.insert(db.tables.users, {
        ...user,
        avatarUrl: null,
        lastLoginAt: null,
        createdAt: NOW,
      });
    }),
  );
  await new MemberModel(db).set("p1", "viewer", "viewer");
  const app = createShelfApp({
    database: db,
    storage,
    auth,
    testing: { runner: stubRunner() },
    config: { secret: "s", scratchDir, publicBaseUrl: "https://shelf.example" },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  booted = app;
  return app;
}

type Booted = Awaited<ReturnType<typeof boot>>;

/** What a caller can observe of an answer. */
async function observed(response: Response): Promise<Record<string, unknown>> {
  return {
    status: response.status,
    body: await response.text(),
    cacheControl: response.headers.get("cache-control"),
    contentType: response.headers.get("content-type"),
    location: response.headers
      .get("location")
      ?.replaceAll(/\/projects\/(?:hidden|ghost)\//gu, "/projects/:slug/"),
  };
}

/** Project-scoped routes (a `:slug` segment) with every other parameter filled in. */
function projectRoutes(): { key: string; method: string; path: string }[] {
  return Object.keys({ ...API_ROUTE_CLASSES, ...PAGE_ROUTE_CLASSES })
    .filter((key) => key.includes("/:slug"))
    .map((key) => {
      const [method = "GET", pattern = ""] = key.split(" ");
      return { key, method, path: pattern.replaceAll(/:[a-zA-Z]+/gu, "x").replaceAll("*", "x") };
    });
}

let requests = 0;

async function ask(
  app: Booted,
  as: string,
  route: { method: string; path: string },
  slug: string,
): Promise<Record<string, unknown>> {
  requests += 1;
  const path = route.path.replace("/projects/x", `/projects/${slug}`);
  const write = route.method !== "GET" && route.method !== "HEAD";
  const response = await app.request(path, {
    method: route.method,
    headers: {
      cookie: `storyshelf_session=${as}`,
      // A fresh client address per request keeps the rate limiter from answering for the routes.
      "x-forwarded-for": `10.1.${Math.floor(requests / 250)}.${requests % 250}`,
      "x-csrf-token": getCsrfToken("s", as),
      ...(write ? { "content-type": "application/json" } : {}),
    },
    ...(write ? { body: "{}" } : {}),
  });
  return await observed(response);
}

describe("a project the caller cannot see", () => {
  it("answers exactly as for a slug that does not exist, on every project-scoped route", async () => {
    const app = await boot();
    const statuses = new Map<string, number>();
    for (const route of projectRoutes()) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one route at a time keeps failures readable
      const hidden = await ask(app, "outsider", route, "hidden");
      // oxlint-disable-next-line eslint/no-await-in-loop -- same
      const unknown = await ask(app, "outsider", route, "ghost");
      expect(hidden, route.key).toEqual(unknown);
      statuses.set(route.key, hidden["status"] as number);
    }
    // Not a vacuous pass: the routes that decide on the project answer 404 (not 400, 429 or 501).
    for (const key of [
      "GET /api/v1/projects/:slug",
      "GET /api/v1/projects/:slug/builds",
      "GET /api/v1/projects/:slug/tokens",
      "GET /api/v1/projects/:slug/members",
      "GET /projects/:slug/settings",
      "GET /projects/:slug/labels",
      "GET /projects/:slug/storybook",
    ]) {
      expect(statuses.get(key), key).toBe(404);
    }
  });

  it("still answers 403 to a member whose role is too low", async () => {
    const app = await boot();
    const asViewer = async (method: string, path: string): Promise<number> =>
      (
        await app.request(path, {
          method,
          headers: {
            cookie: "storyshelf_session=viewer",
            "x-csrf-token": getCsrfToken("s", "viewer"),
            "content-type": "application/json",
          },
          ...(method === "GET" ? {} : { body: "{}" }),
        })
      ).status;
    expect(await asViewer("GET", "/api/v1/projects/hidden/tokens")).toBe(403);
    expect(await asViewer("DELETE", "/api/v1/projects/hidden/tokens/t1")).toBe(403);
    expect(await asViewer("GET", "/api/v1/projects/hidden/builds")).toBe(200);
  });

  it("shows a site admin every project", async () => {
    const app = await boot();
    const response = await app.request("/api/v1/projects/hidden/builds", {
      headers: { cookie: "storyshelf_session=admin" },
    });
    expect(response.status).toBe(200);
  });
});
