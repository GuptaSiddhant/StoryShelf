import type { StorybookHostingConfig } from "@storyshelf/core/config";
import { LabelModel } from "@storyshelf/core/models";
/**
 * Legacy links (#360): the project path, the short link (by build id and by slug), the project and
 * label resolvers and the alias host stay entry points in every hosting mode. In `subdomain` mode they
 * are checked on the portal and sent to the build's content host (ADR 0051, decision 5) with the story
 * path and query kept, and no path or query can steer the redirect to another host.
 */
import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { storybookDir } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

const SECRET = "legacy-links-secret-legacy-links-1";
/** The older approved default-branch build (public). */
const OLD = "01ARZ3NDEKTSV4RRFFQ69G5FA1";
/** The newer approved default-branch build (public), uploaded later in a test. */
const NEW = "01ARZ3NDEKTSV4RRFFQ69G5FA2";
/** A private build on a private project. */
const PRIV = "01ARZ3NDEKTSV4RRFFQ69G5FA3";
const BASE = "shelf.example.com";
const PORTAL = `https://${BASE}`;
const hostOf = (id: string): string => `https://${id.toLowerCase()}.${BASE}`;
const admin = { id: "u1", email: "a@example.com", name: "Ada", role: "admin" as const };
const stranger = { id: "u2", email: "b@example.com", name: "Bo", role: "member" as const };
const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
const SUBDOMAIN: StorybookHostingConfig = { mode: "subdomain", baseDomain: BASE };

function project(id: string, slug: string): Project {
  return {
    id,
    name: slug,
    slug,
    gitRepository: "owner/repo",
    gitDefaultBranch: "main",
    pixelThreshold: 0.1,
    maxDiffRatio: 0.01,
    publicBranchRegex: null,
    executePlay: false,
    playTimeoutMs: 10_000,
    storybookMeta: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function build(id: string, projectId: string, overrides: Partial<Build> = {}): Build {
  return {
    id,
    projectId,
    gitSha: `sha-${id}`,
    gitBranch: "main",
    isDefault: true,
    authorEmail: null,
    authorName: null,
    message: null,
    public: projectId === "pub",
    status: "approved",
    snapshotCount: 0,
    changedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    inheritedCount: 0,
    affectedOnly: true,
    baselineSha: null,
    changedFiles: null,
    affectedImportPaths: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

interface BootOptions {
  user?: typeof admin | typeof stranger;
  hosting?: StorybookHostingConfig;
}

async function boot(options: BootOptions = {}) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, project("pub", "open-project"));
  await db.insert(db.tables.projects, project("priv", "closed-project"));
  await db.insert(db.tables.builds, build(OLD, "pub"));
  await db.insert(db.tables.builds, build(PRIV, "priv"));
  for (const [projectId, id] of [
    ["pub", OLD],
    ["pub", NEW],
    ["priv", PRIV],
  ] as const) {
    const dir = storybookDir(projectId, id);
    objects.set(`${dir}/index.html`, Buffer.from(`<html>manager ${id}</html>`));
    objects.set(`${dir}/iframe.html`, Buffer.from(`<html>preview ${id}</html>`));
  }
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    auth: stubAuth(options.user ?? admin, { hostSessionCookie: true }),
    testing: { runner: stubRunner() },
    config: {
      secret: SECRET,
      publicBaseUrl: PORTAL,
      ...(options.hosting ? { storybookHosting: options.hosting } : {}),
    },
  });
  /** Upload a newer approved default-branch build of the public project. */
  const publishNewer = async (): Promise<void> => {
    await db.insert(
      db.tables.builds,
      build(NEW, "pub", {
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
    );
  };
  const label = async (buildId: string, key: string, value: string): Promise<void> => {
    await new LabelModel(db).attach("pub", buildId, key, value);
  };
  return { app, publishNewer, label };
}

type App = Awaited<ReturnType<typeof boot>>["app"];

const get = (app: App, url: string, headers: Record<string, string> = NAV) =>
  app.request(url, { headers });

const locationOf = (response: Response): string => response.headers.get("location") ?? "";

/** Follow portal-local redirects until the answer leaves the portal (or stops redirecting). */
async function follow(app: App, url: string): Promise<Response> {
  let response = await get(app, url);
  for (let hop = 0; hop < 5 && response.status === 302; hop += 1) {
    const next = new URL(locationOf(response), url);
    if (next.origin !== PORTAL) {
      return response;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- each hop depends on the last
    response = await get(app, next.href);
  }
  return response;
}

describe("legacy links in subdomain mode", () => {
  it("sends a slug short link to the latest approved default build's content host", async () => {
    const { app } = await boot({ hosting: SUBDOMAIN });
    const response = await get(app, `${PORTAL}/_/open-project/iframe.html?id=a--b`);
    expect(response.status).toBe(302);
    expect(locationOf(response)).toBe(`${hostOf(OLD)}/iframe.html?id=a--b`);
  });

  it("moves a slug link to a newer approved build, and keeps a build-id link where it was", async () => {
    const { app, publishNewer } = await boot({ hosting: SUBDOMAIN });
    await publishNewer();
    expect(locationOf(await get(app, `${PORTAL}/_/open-project/`))).toBe(`${hostOf(NEW)}/`);
    expect(locationOf(await get(app, `${PORTAL}/_/${OLD}/`))).toBe(`${hostOf(OLD)}/`);
    const resolved = await follow(app, `${PORTAL}/projects/open-project/storybook`);
    expect(locationOf(resolved)).toBe(`${hostOf(NEW)}/`);
  });

  it("keeps a deep link's query through the project resolver", async () => {
    const { app } = await boot({ hosting: SUBDOMAIN });
    const path = encodeURIComponent("/story/button--primary");
    const first = await get(app, `${PORTAL}/projects/open-project/storybook?path=${path}`);
    expect(locationOf(first)).toBe(`/projects/open-project/storybook/build/${OLD}/?path=${path}`);
    const final = await follow(app, `${PORTAL}/projects/open-project/storybook?path=${path}`);
    expect(locationOf(final)).toBe(`${hostOf(OLD)}/?path=${path}`);
  });

  it("maps a storyId deep link through the project resolver to the manager's path", async () => {
    const { app } = await boot({ hosting: SUBDOMAIN });
    const final = await follow(
      app,
      `${PORTAL}/projects/open-project/storybook?storyId=button--primary&viewMode=docs`,
    );
    expect(locationOf(final)).toBe(
      `${hostOf(OLD)}/?path=${encodeURIComponent("/docs/button--primary")}`,
    );
  });

  it("keeps a deep link's query through a label link", async () => {
    const { app, label } = await boot({ hosting: SUBDOMAIN });
    await label(OLD, "pr", "12");
    const final = await follow(app, `${PORTAL}/projects/open-project/storybook/pr/12?path=%2Fx`);
    expect(locationOf(final)).toBe(`${hostOf(OLD)}/?path=%2Fx`);
  });

  it("sends a private build's legacy links through the exchange", async () => {
    const { app } = await boot({ hosting: SUBDOMAIN });
    for (const url of [
      `${PORTAL}/_/closed-project/iframe.html?id=a--b`,
      `${PORTAL}/_/${PRIV}/iframe.html?id=a--b`,
      `${PORTAL}/projects/closed-project/storybook/build/${PRIV}/iframe.html?id=a--b`,
    ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const location = new URL(locationOf(await follow(app, url)));
      expect(location.origin).toBe(hostOf(PRIV));
      expect(location.pathname).toMatch(/^\/_x\/[\w-]+\.[\w-]{43}\/iframe\.html$/u);
      expect(location.search).toBe("?id=a--b");
    }
  });

  it("answers a viewer with no role on a private project's links as for a missing one", async () => {
    const { app } = await boot({ hosting: SUBDOMAIN, user: stranger });
    const missing = await get(app, `${PORTAL}/_/no-such-project/`);
    for (const url of [`${PORTAL}/_/closed-project/`, `${PORTAL}/_/${PRIV}/`]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const response = await get(app, url);
      expect(response.status).toBe(missing.status);
      expect(response.headers.get("location")).toBeNull();
    }
    const resolver = await get(app, `${PORTAL}/projects/closed-project/storybook`);
    const unknown = await get(app, `${PORTAL}/projects/no-such-project/storybook`);
    expect(resolver.status).toBe(unknown.status);
  });

  it("keeps the query on the alias host, but never the path", async () => {
    const { app } = await boot({ hosting: SUBDOMAIN });
    const response = await get(app, `https://open-project.${BASE}/iframe.html?path=%2Fstory%2Fa`);
    expect(locationOf(response)).toBe(
      `${PORTAL}/projects/open-project/storybook?path=%2Fstory%2Fa`,
    );
  });
});

describe("no legacy link redirects off its host", () => {
  const TRICKY = [
    "//evil.example/x",
    "/%2F%2Fevil.example/x",
    "/%5Cevil.example/x",
    String.raw`/\evil.example/x`,
    "/@evil.example/x",
    "/..%2F..%2Fx",
    "/%2e%2e/%2e%2e/x",
    "/a%0D%0ASet-Cookie:%20x=1",
    "/https:%2F%2Fevil.example",
  ];

  it("keeps the content host as the target of every short-link path", async () => {
    const { app } = await boot({ hosting: SUBDOMAIN });
    for (const rest of TRICKY) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const response = await get(app, `${PORTAL}/_/${OLD}${rest}`);
      if (response.status === 302) {
        expect(new URL(locationOf(response)).origin).toBe(hostOf(OLD));
        expect(locationOf(response)).not.toMatch(/[\r\n]/u);
      } else {
        expect(response.status).toBe(404);
      }
    }
  });

  it("keeps the portal as the target of a resolver, whatever the query holds", async () => {
    const { app } = await boot({ hosting: SUBDOMAIN });
    for (const query of ["?x=//evil.example", "?@evil.example", "?a=%0D%0ALocation:%20x"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const response = await get(app, `${PORTAL}/projects/open-project/storybook${query}`);
      expect(locationOf(response)).toMatch(/^\/projects\/open-project\/storybook\/build\//u);
      expect(locationOf(response)).not.toMatch(/[\r\n]/u);
    }
  });

  it("keeps the portal as the target of the alias host, whatever the query holds", async () => {
    const { app } = await boot({ hosting: SUBDOMAIN });
    const response = await get(app, `https://open-project.${BASE}//evil.example?next=//evil`);
    expect(new URL(locationOf(response)).origin).toBe(PORTAL);
  });
});

describe("legacy links in path-hosting modes", () => {
  for (const hosting of [undefined, { mode: "sandboxed" } as const]) {
    const name = hosting?.mode ?? "trusted";
    it(`keeps the deep link's query through the resolvers (${name})`, async () => {
      const { app, label } = await boot(hosting ? { hosting } : {});
      await label(OLD, "pr", "7");
      const latest = await get(app, `${PORTAL}/projects/open-project/storybook?path=%2Fstory%2Fa`);
      expect(locationOf(latest)).toBe(
        `/projects/open-project/storybook/build/${OLD}/?path=%2Fstory%2Fa`,
      );
      const labelled = await get(app, `${PORTAL}/projects/open-project/storybook/pr/7?id=a--b`);
      expect(locationOf(labelled)).toBe(`/projects/open-project/storybook/build/${OLD}/?id=a--b`);
    });

    it(`serves the legacy short link in place (${name})`, async () => {
      const { app } = await boot(hosting ? { hosting } : {});
      const response = await get(app, `${PORTAL}/_/open-project/iframe.html`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`<html>preview ${OLD}</html>`);
    });
  }
});
