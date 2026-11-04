import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

/**
 * A value with a `.` or `..` segment travels in the query of the same page (the browser would
 * otherwise resolve the segment away): every link `UrlBuilder` makes opens the page it names.
 */
const T0 = "2026-01-01T00:00:00.000Z";
const urls = createUrlBuilder("");
const apps: ReturnType<typeof createShelfApp>[] = [];
afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
});

async function seed(importPath: string) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "App",
    slug: "app",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "sha-b1000",
    gitBranch: "main",
    isDefault: true,
    status: "approved",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  await db.insert(db.tables.snapshots, {
    id: "s1",
    projectId: "p1",
    buildId: "b1",
    storyId: "button--primary",
    storyName: "primary",
    storyTitle: "Components/Button",
    storyImportPath: importPath,
    screenshotPath: "x/1.png",
    status: "approved",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret: "s" },
    testing: { runner: stubRunner() },
  });
  apps.push(app);
  return app;
}

const open = async (app: ReturnType<typeof createShelfApp>, link: string) =>
  await app.request(link.replace(/^https?:\/\/[^/]+/u, ""));

describe("component links with a dot segment", () => {
  it.each(["../ui/Button.stories.tsx", "src/../ui/Button.stories.tsx", "src/./Button.stories.tsx"])(
    "open the page of %s through the query form",
    async (importPath) => {
      const app = await seed(importPath);
      const link = urls.component("app", importPath);
      expect(link).toContain("?path=");
      const res = await open(app, link);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('id="button--primary"');
      expect(html).toContain(importPath);
    },
  );

  it.each(["overview", "stories", "history"])(
    "keeps the file in every relative link of the %s tab opened through the query form",
    async (tab) => {
      const importPath = "../ui/Button.stories.tsx";
      const app = await seed(importPath);
      const base = urls.component("app", importPath, { tab });
      const html = await (await open(app, base)).text();
      const encoded = encodeURIComponent(importPath);
      const links = [...html.matchAll(/href="(\?[^"#]*)[^"]*"/gu)].map((match) =>
        (match[1] ?? "").replaceAll("&amp;", "&"),
      );
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link).toContain(`path=${encoded}`);
        // oxlint-disable-next-line no-await-in-loop -- a handful of requests, in order
        expect((await app.request(`/projects/app/components/${link}`)).status).toBe(200);
      }
    },
  );

  it("keeps the query form together with a tab", async () => {
    const app = await seed("../ui/Button.stories.tsx");
    const link = urls.component("app", "../ui/Button.stories.tsx", { tab: "history" });
    expect((await open(app, link)).status).toBe(200);
  });

  it("still answers a path-form link, and a plain import path keeps it", async () => {
    const app = await seed("./src/Button.stories.tsx");
    const link = urls.component("app", "./src/Button.stories.tsx");
    expect(link).not.toContain("?");
    expect((await open(app, link)).status).toBe(200);
  });

  it("answers 404 for a query path no build has", async () => {
    const app = await seed("../ui/Button.stories.tsx");
    expect((await open(app, urls.component("app", "../ui/Missing.stories.tsx"))).status).toBe(404);
  });
});

describe("label links with a dot segment", () => {
  it.each(["..", ".", "a/../b", "%2E%2E", "v1.0"])(
    "open the page of the label value %s",
    async (value) => {
      const app = await seed("./src/Button.stories.tsx");
      const res = await open(app, urls.label("app", "release", value));
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`release: ${value}`);
    },
  );
});

async function gated() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({
    database: db,
    storage,
    auth: stubAuth(null),
    logger: pino({ level: "silent" }),
    config: { secret: "s" },
    testing: { runner: stubRunner() },
  });
  apps.push(app);
  return app;
}

describe("the auth gate and the query form", () => {
  it.each([
    "/projects/app/components/storybook?path=../ui/Button.stories.tsx",
    "/projects/app/components/x/storybook/y?path=../ui/Button.stories.tsx",
    "/projects/app/labels/release/storybook?value=..",
  ])("sends an anonymous visitor to login for %s, whatever the path tail says", async (link) => {
    const response = await (await gated()).request(link);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/login");
  });

  it("still lets an anonymous visitor reach the published Storybook routes", async () => {
    const app = await gated();
    for (const link of ["/projects/app/storybook", "/projects/app/storybook/branch/main"]) {
      // oxlint-disable-next-line no-await-in-loop -- sequential, tiny
      expect((await app.request(link)).status).not.toBe(302);
    }
  });
});
