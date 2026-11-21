import { LabelModel, MemberModel, TokenModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { ProjectRole } from "@storyshelf/core/types";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { PAGE_ROUTE_CLASSES } from "../routes/page-routes.ts";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

/**
 * Ratchet for issue #1268: every state-changing project-settings or delete form refuses a viewer
 * and a developer (403) and writes nothing. `FORMS` must name every such key of `page-routes.ts`,
 * so a new form fails here until it is listed (and, being listed, is checked).
 */
const NOW = "2026-01-01T00:00:00.000Z";
const ROLES: Record<string, ProjectRole> = { boss: "admin", dev: "developer", view: "viewer" };
const SLUG = "vault";
const PROJECT_FORM = /^(?:POST|PUT|PATCH|DELETE) \/projects\/:slug\/(?:settings(?:\/|$)|delete$)/u;

/** Forms any member may post: they change only the caller's own data. */
const OPEN_TO_MEMBERS = new Set(["POST /projects/:slug/settings/notifications/me"]);

/** Every admin-only project form, with the path parameters it is posted with. */
const FORMS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "POST /projects/:slug/settings": {},
  "POST /projects/:slug/settings/review": {},
  "POST /projects/:slug/delete": {},
  "POST /projects/:slug/settings/labels": {},
  "POST /projects/:slug/settings/labels/:key": { key: "status" },
  "POST /projects/:slug/settings/labels/:key/delete": { key: "status" },
  "POST /projects/:slug/settings/links": {},
  "POST /projects/:slug/settings/links/delete": {},
  "POST /projects/:slug/settings/design/files": {},
  "POST /projects/:slug/settings/design/files/:id/delete": { id: "missing" },
  "POST /projects/:slug/settings/design/components": {},
  "POST /projects/:slug/settings/design/components/:id/delete": { id: "missing" },
  "POST /projects/:slug/settings/design/:provider/token": { provider: "figma" },
  "POST /projects/:slug/settings/design/:provider/token/delete": { provider: "figma" },
  "POST /projects/:slug/settings/tokens": {},
  "POST /projects/:slug/settings/tokens/:tokenId/delete": { tokenId: "seeded-token" },
  "POST /projects/:slug/settings/webhooks": {},
  "POST /projects/:slug/settings/webhooks/:webhookId/delete": { webhookId: "missing" },
  "POST /projects/:slug/settings/git": {},
  "POST /projects/:slug/settings/git/:linkId": { linkId: "missing" },
  "POST /projects/:slug/settings/git/:linkId/delete": { linkId: "missing" },
  "POST /projects/:slug/settings/notifications": {},
  "POST /projects/:slug/settings/notifications/:channelId/edit": { channelId: "missing" },
  "POST /projects/:slug/settings/notifications/:channelId/delete": { channelId: "missing" },
  "POST /projects/:slug/settings/notifications/:channelId/retry": { channelId: "missing" },
  "POST /projects/:slug/settings/members": {},
  "POST /projects/:slug/settings/members/:userId/remove": { userId: "boss" },
  "POST /projects/:slug/settings/members/owners": {},
  "POST /projects/:slug/settings/members/groups": {},
  "POST /projects/:slug/settings/members/groups/:mappingId/remove": { mappingId: "missing" },
  "POST /projects/:slug/settings/tests": {},
  "POST /projects/:slug/settings/capture": {},
  "POST /projects/:slug/settings/capture/superseded": {},
  "POST /projects/:slug/settings/thresholds": {},
  "POST /projects/:slug/settings/ai": {},
};

/** Fields that would change something on every form above if the post were accepted. */
const BODY = {
  name: "Taken over",
  publicBranchRegex: ".*",
  gitDefaultBranch: "main",
  userId: "view",
  role: "admin",
  group: "everyone",
  label: "Owned",
  key: "owned",
  package: "pkg",
  upstreamSlug: SLUG,
  url: "https://hooks.example/owned",
  events: "build:completed",
  provider: "slack",
  target: "https://hooks.example/owned",
  token: "owned",
  pixelThreshold: "0.9",
  maxDiffRatio: "0.9",
  reviewEnabled: "off",
  reviewApprovals: "5",
  runTests: "on",
};

const users = [...Object.keys(ROLES), "outsider"].map((id) => ({
  id,
  email: `${id}@example.com`,
  name: id,
  role: "member" as const,
}));
const auth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    const id = /storyshelf_session=(?<id>\w+)/u.exec(cookie)?.groups?.["id"];
    return await Promise.resolve(users.find((user) => user.id === id) ?? null);
  },
});

let scratchDir = "";
const stops: (() => Promise<void>)[] = [];
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-settings-forms-"));
});
afterEach(async () => {
  try {
    await Promise.all(stops.splice(0).map(async (stop) => await stop()));
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});

type Db = ReturnType<typeof makeDatabase>["db"];

async function seed(db: Db): Promise<void> {
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Vault",
    slug: SLUG,
    gitRepository: null,
    gitDefaultBranch: "main",
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
  await Promise.all(
    Object.entries(ROLES).map(async ([id, role]) => await new MemberModel(db).set("p1", id, role)),
  );
  await new LabelModel(db).seedFor("p1");
  await new TokenModel(db).issue("p1", { name: "CI", userId: "boss" });
}

/** Every row of every table, to prove a refused post wrote nothing. */
async function snapshot(db: Db): Promise<unknown> {
  const tables = Object.entries(db.tables).toSorted(([a], [b]) => a.localeCompare(b));
  return await Promise.all(tables.map(async ([name, table]) => [name, await db.list(table)]));
}

async function boot() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await seed(db);
  const app = createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    auth,
    config: { secret: "s", scratchDir, publicBaseUrl: "https://shelf.example" },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  stops.push(async () => await app.lifecycle.teardown());
  return { app, db };
}

/** The form's path, with `seeded-token` standing for the id of the token `seed` issued. */
function pathOf(key: string, params: Readonly<Record<string, string>>, tokenId: string): string {
  const pattern = key.slice(key.indexOf(" ") + 1).replace(":slug", SLUG);
  return pattern.replaceAll(/:(?<name>\w+)/gu, (match, name: string) => {
    const value = params[name] ?? match;
    return value === "seeded-token" ? tokenId : value;
  });
}

async function seededTokenId(db: Db): Promise<string> {
  const [token] = await new TokenModel(db).list("p1");
  return token?.id ?? "";
}

function post(
  app: Awaited<ReturnType<typeof boot>>["app"],
  method: string,
  path: string,
  user: string,
) {
  return app.request(path, {
    method,
    headers: {
      cookie: `storyshelf_session=${user}`,
      "x-csrf-token": getCsrfToken("s", user),
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(BODY).toString(),
  });
}

const projectForms = Object.keys(PAGE_ROUTE_CLASSES).filter((key) => PROJECT_FORM.test(key));

describe("project settings forms require the admin role (#1268)", () => {
  it("lists every state-changing project settings and delete form", () => {
    const listed = projectForms.filter((key) => !OPEN_TO_MEMBERS.has(key));
    expect(listed.toSorted()).toEqual(Object.keys(FORMS).toSorted());
  });

  it.each(["view", "dev"])("refuses a %s on every form and writes nothing", async (user) => {
    const { app, db } = await boot();
    const tokenId = await seededTokenId(db);
    const before = await snapshot(db);
    const refusals = await Promise.all(
      Object.entries(FORMS).map(async ([key, params]) => {
        const path = pathOf(key, params, tokenId);
        const answer = await post(app, key.slice(0, key.indexOf(" ")), path, user);
        return [key, answer.status] as const;
      }),
    );
    expect(refusals.filter(([, status]) => status !== 403)).toEqual([]);
    expect(await snapshot(db)).toEqual(before);
  });

  it("still saves for a project admin", async () => {
    const { app, db } = await boot();
    const saved = await post(app, "POST", `/projects/${SLUG}/settings/members`, "boss");
    expect(saved.status).toBeLessThan(400);
    expect(await new MemberModel(db).effectiveRole("member", "p1", "view")).toBe("admin");
  });

  it("leaves project deletion to a site admin, as the API does", async () => {
    const { app, db } = await boot();
    const refused = await post(app, "POST", `/projects/${SLUG}/delete`, "boss");
    expect(refused.status).toBe(403);
    expect(await db.get(db.tables.projects, "p1")).not.toBeNull();
  });

  it("lets a viewer save their own notification preferences", async () => {
    const { app } = await boot();
    const saved = await post(app, "POST", `/projects/${SLUG}/settings/notifications/me`, "view");
    expect(saved.status).toBeLessThan(400);
  });
});
