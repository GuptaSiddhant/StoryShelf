import { createShelfLogger } from "@storyshelf/core/logger";
import { ProjectModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

function boot(): { app: ReturnType<typeof createShelfApp>; ready: Promise<unknown> } {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const ready = new ProjectModel(db).create({ name: "Docs" });
  const app = createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  return { app, ready };
}

async function get(path: string): Promise<string> {
  const { app, ready } = boot();
  await ready;
  return await (await app.request(path)).text();
}

describe("project settings tabs", () => {
  it("shows five grouped tabs across the top, the current one marked, and no second sidebar", async () => {
    const html = await get("/projects/docs/settings/access");
    expect(html).toContain('aria-label="Settings sections"');
    for (const label of [
      "General",
      "Capture &amp; tests",
      "Review &amp; notifications",
      "Access",
      "Insights",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(
      /href="\/projects\/docs\/settings\/access"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/projects\/docs\/settings\/access"/u,
    );
    expect(html).not.toContain("subnav");
  });

  it("puts each section on its tab", async () => {
    const expected: Record<string, string[]> = {
      general: ["general", "links"],
      capture: ["thresholds", "capture", "tests", "design"],
      review: ["review", "owners", "labels", "notifications"],
      access: ["members", "tokens", "webhooks"],
      insights: ["insights"],
    };
    const { app, ready } = boot();
    await ready;
    for (const [tab, sections] of Object.entries(expected)) {
      // eslint-disable-next-line no-await-in-loop -- few tabs
      const html = await (await app.request(`/projects/docs/settings/${tab}`)).text();
      for (const section of sections) {
        expect(html, `${tab} holds ${section}`).toContain(`id="${section}"`);
      }
    }
  });

  it("opens a label type for editing from the review tab", async () => {
    const html = await get("/projects/docs/settings/review?edit=jira");
    expect(html).toContain('id="labels"');
  });

  it("links to the Labels overview from the labels section, so it stays reachable", async () => {
    const html = await get("/projects/docs/settings/review");
    expect(html).toContain('href="/projects/docs/labels"');
  });
});

describe("project settings pages", () => {
  it("answers 404 for a tab that does not exist", async () => {
    const { app, ready } = boot();
    await ready;
    expect((await app.request("/projects/docs/settings/nope")).status).toBe(404);
  });

  it("renders tables through the shared Table surface", async () => {
    const pages = await Promise.all(
      ["access", "review"].map(async (tab) => await get(`/projects/docs/settings/${tab}`)),
    );
    for (const html of pages) {
      expect(html).not.toContain("table-wrap");
    }
  });
});

describe("old settings, labels and jobs URLs", () => {
  const moved: Record<string, string> = {
    "/projects/docs/settings": "/projects/docs/settings/general",
    "/projects/docs/settings/links": "/projects/docs/settings/general#links",
    "/projects/docs/settings/tests": "/projects/docs/settings/capture#tests",
    "/projects/docs/settings/ai": "/projects/docs/settings/capture#ai",
    "/projects/docs/settings/design": "/projects/docs/settings/capture#design",
    "/projects/docs/settings/labels": "/projects/docs/settings/review#labels",
    "/projects/docs/settings/notifications": "/projects/docs/settings/review#notifications",
    "/projects/docs/settings/members": "/projects/docs/settings/access#members",
    "/projects/docs/settings/tokens": "/projects/docs/settings/access#tokens",
    "/projects/docs/settings/webhooks": "/projects/docs/settings/access#webhooks",
    "/projects/docs/jobs": "/projects/docs/settings/insights",
  };

  it("redirect to the tab that holds them", async () => {
    const { app, ready } = boot();
    await ready;
    for (const [from, to] of Object.entries(moved)) {
      // eslint-disable-next-line no-await-in-loop -- few URLs
      const response = await app.request(from);
      expect(response.status, from).toBe(302);
      expect(response.headers.get("location"), from).toBe(to);
    }
  });

  it("keep the query string, so an edit link still opens its form", async () => {
    const { app, ready } = boot();
    await ready;
    const response = await app.request("/projects/docs/settings/labels?edit=jira");
    expect(response.headers.get("location")).toBe(
      "/projects/docs/settings/review?edit=jira#labels",
    );
  });

  it("still serve the jobs queue fragment the Insights tab refreshes", async () => {
    const { app, ready } = boot();
    await ready;
    const response = await app.request("/projects/docs/jobs?partial=queue");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="active-queue"');
  });

  it("answer 404 for a project that does not exist", async () => {
    const { app, ready } = boot();
    await ready;
    expect((await app.request("/projects/ghost/jobs")).status).toBe(404);
  });
});

describe("Insights tab", () => {
  it("starts with the empty state, then the jobs list, and no longer sits on the Builds page", async () => {
    const insights = await get("/projects/docs/settings/insights");
    expect(insights).toContain("No captured builds yet");
    expect(insights).toContain("Active queue");
    expect(insights).toContain("Recent builds");
    const builds = await get("/projects/docs/builds");
    expect(builds).not.toContain("Average inherited share per build");
    expect(builds).not.toContain("Active queue");
  });
});
