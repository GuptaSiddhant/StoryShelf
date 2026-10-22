import { catalogueBuild } from "@storyshelf/core/capture";
import { BuildModel } from "@storyshelf/core/models";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import { storybookDir, verifyStorybookToken } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";
import { PREVIEW_TOKEN_TTL } from "./preview-base.ts";

type Entries = Record<string, [title: string, name: string, file: string, type?: string]>;

function indexOf(entries: Entries): unknown {
  return {
    v: 5,
    entries: Object.fromEntries(
      Object.entries(entries).map(([id, [title, name, importPath, type]]) => [
        id,
        { id, title, name, importPath, type: type ?? "story", tags: ["dev"] },
      ]),
    ),
  };
}

const BUTTON = "./src/Button.stories.tsx";

/** Three builds of `main`: b1 has Button (2 stories) and Old; b2 adds a story, renames one, moves Card. */
async function seed(
  options: { testing?: boolean; auth?: boolean; publicBuilds?: boolean; secret?: string } = {},
) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const project = await createTestProject(db, db.tables, { name: "app" });
  const builds = new BuildModel(db);
  const publish = async (sha: string, createdAt: string, index: unknown, branch = "main") => {
    const created = await createTestBuild(db, db.tables, project.id, {
      gitSha: sha,
      gitBranch: branch,
    });
    await db.update(db.tables.builds, created.id, {
      createdAt,
      public: options.publicBuilds ?? false,
    } as never);
    await builds.setStatus(created.id, "approved");
    objects.set(
      `${storybookDir(project.id, created.id)}/index.json`,
      Buffer.from(JSON.stringify(index)),
    );
    await catalogueBuild({ db, storage }, project.id, created.id);
    return created;
  };
  const b1 = await publish(
    "sha-b1",
    "2026-01-01T00:00:00.000Z",
    indexOf({
      "button--primary": ["Components/Button", "Primary", BUTTON],
      "button--secondary": ["Components/Button", "Secondary", BUTTON],
      "old--default": ["Components/Old", "Default", "./src/Old.stories.tsx"],
      "card--basic": ["Components/Card", "Basic", "./src/Card.stories.tsx"],
    }),
  );
  const b2 = await publish(
    "sha-b2",
    "2026-01-02T00:00:00.000Z",
    indexOf({
      "button--primary": ["Components/Button", "Main", BUTTON],
      "button--secondary": ["Components/Button", "Secondary", BUTTON],
      "button--tertiary": ["Components/Button", "Tertiary", BUTTON],
      "button--docs": ["Components/Button", "Docs", BUTTON, "docs"],
      "card--basic": ["Components/Card", "Basic", "./src/ui/Card.stories.tsx"],
    }),
  );
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    ...(options.secret ? { config: { secret: options.secret } } : {}),
    ...(options.testing ? { testing: { runner: stubRunner() } } : {}),
    ...(options.auth
      ? { auth: stubAuth({ id: "u1", email: "a@example.com", name: "Ada", role: "admin" }) }
      : {}),
  });
  return { app, db, objects, project, b1, b2 };
}

const page = async (app: Awaited<ReturnType<typeof seed>>["app"], path: string) =>
  await (await app.request(`/projects/app/components/${path}`)).text();

describe("component page without testing", () => {
  it("shows the stories and docs of the newest build, with a click-to-load sandboxed preview", async () => {
    const { app, b2 } = await seed();
    const response = await app.request("/projects/app/components/src/Button.stories.tsx");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Components/Button");
    expect(html).toContain("3 stories · 1 docs");
    for (const name of ["Main", "Secondary", "Tertiary", "Docs"]) {
      expect(html).toContain(`>${name}<`);
    }
    expect(html).toContain("viewMode=docs");
    expect(html).toContain("data-preview-load");
    expect(html).toContain('id="preview"');
    expect(html).toMatch(
      new RegExp(
        `<template data-preview-template[^>]*><iframe[^>]*src="/projects/app/storybook/build/${b2.id}/iframe.html\\?id=button--primary&amp;viewMode=story"`,
        "u",
      ),
    );
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
  });

  it("previews the story named by ?story=", async () => {
    const { app } = await seed();
    const html = await page(app, "src/Button.stories.tsx?story=button--tertiary");
    expect(html).toContain("iframe.html?id=button--tertiary");
    expect(html).not.toContain("iframe.html?id=button--primary");
  });

  it("offers only the Stories and History tabs, and shows no snapshot data", async () => {
    const { app } = await seed();
    const html = await page(app, "src/Button.stories.tsx?tab=states");
    expect(html).toContain("?tab=stories");
    expect(html).toContain("?tab=history");
    expect(html).not.toContain("?tab=states");
    expect(html).not.toContain("?tab=design");
    expect(html).toContain("data-preview-load");
  });

  it("lists the builds holding the file and what changed since the build before", async () => {
    const { app, b1, b2 } = await seed();
    const html = await page(app, "src/Button.stories.tsx?tab=history");
    expect(html).toContain("Published builds");
    expect(html).toContain(`/projects/app/builds/${b2.id}`);
    expect(html).toContain(`/projects/app/builds/${b1.id}`);
    expect(html).toContain("changed");
    expect(html).toContain("2 added");
    expect(html).toContain("1 renamed");
    expect(html).toContain("new here");
  });

  it("says where a moved file went and where a deleted one was last seen", async () => {
    const { app } = await seed();
    const moved = await page(app, "src/Card.stories.tsx");
    expect(moved).toContain("This component moved");
    expect(moved).toContain("/projects/app/components/src/ui/Card.stories.tsx");
    const deleted = await page(app, "src/Old.stories.tsx");
    expect(deleted).toContain("Not in the latest build");
    expect(deleted).toContain("sha-b1");
  });

  it("404s for files no build holds, empty paths and unknown projects", async () => {
    const { app } = await seed();
    expect((await app.request("/projects/app/components/src/Nope.stories.tsx")).status).toBe(404);
    expect((await app.request("/projects/app/components/")).status).toBe(404);
    expect((await app.request("/projects/zzz/components/src/Button.stories.tsx")).status).toBe(404);
  });

  it("catalogues the latest build lazily so presence and history work for older publishes", async () => {
    const { app, db, project, objects } = await seed();
    // forget every row and catalog, as for builds published before the catalog existed
    const rows = (await db.list(db.tables.buildComponents)) as unknown as { id: string }[];
    await Promise.all(rows.map(async (row) => await db.remove(db.tables.buildComponents, row.id)));
    for (const key of [...objects.keys()].filter((path) => path.endsWith("/catalog.json"))) {
      objects.delete(key);
    }
    const html = await page(app, "src/Button.stories.tsx");
    expect(html).toContain("Components/Button");
    expect(((await db.list(db.tables.buildComponents)) as unknown[]).length).toBeGreaterThan(0);
    expect(project.slug).toBe("app");
  });

  it("does not offer a frame for a private build under sign-in", async () => {
    const { app } = await seed({ auth: true });
    const html = await page(app, "src/Button.stories.tsx");
    expect(html).toContain("needs a sign-in");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("data-preview-load");
    expect(html).toContain("Open");
  });

  it("frames a private build under sign-in through a short-lived signed URL when testing is on", async () => {
    const secret = "preview-secret-preview-secret";
    const { app, project, b2 } = await seed({ auth: true, testing: true, secret });
    const html = await page(app, "src/Button.stories.tsx");
    const token = /<iframe[^>]*src="\/_s\/([^/]+)\/iframe\.html\?id=button--primary/u.exec(
      html,
    )?.[1];
    expect(token).toBeDefined();
    const verified = verifyStorybookToken(token, secret);
    expect(verified).toMatchObject({
      ok: true,
      claims: { projectId: project.id, buildId: b2.id },
    });
    const left = verified.ok ? verified.claims.expiresAt - Date.now() / 1000 : 0;
    expect(left).toBeLessThanOrEqual(PREVIEW_TOKEN_TTL);
    expect(html).not.toContain("needs a sign-in");
  });

  it("lets a frame under a signed URL ask for a fresh token, and answers only viewers who may open the build", async () => {
    const secret = "preview-secret-preview-secret";
    const { app, project, b2 } = await seed({ auth: true, testing: true, secret });
    const html = await page(app, "src/Button.stories.tsx");
    expect(html).toContain(`data-preview-refresh-url="/api/v1/projects/app/builds/${b2.id}/preview-token"`);
    expect(html).toContain("data-preview-refresh-seconds=");
    const response = await app.request(`/api/v1/projects/app/builds/${b2.id}/preview-token`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const { base } = (await response.json()) as { base: string };
    const token = /^\/_s\/([^/]+)$/u.exec(base)?.[1];
    expect(verifyStorybookToken(token, secret)).toMatchObject({
      ok: true,
      claims: { projectId: project.id, buildId: b2.id },
    });
    expect((await app.request("/api/v1/projects/app/builds/nope/preview-token")).status).toBe(404);
  });

  it("offers no refresh for a frame that needs no token", async () => {
    const { app, b2 } = await seed({ auth: true, publicBuilds: true });
    expect(await page(app, "src/Button.stories.tsx")).not.toContain("data-preview-refresh-url");
    expect((await app.request(`/api/v1/projects/app/builds/${b2.id}/preview-token`)).status).toBe(404);
  });

  it("offers no frame for a private build when there is no testing to serve a signed URL", async () => {
    const { app } = await seed({
      auth: true,
      secret: "preview-secret-preview-secret",
    });
    expect(await page(app, "src/Button.stories.tsx")).toContain("needs a sign-in");
  });

  it("offers the frame for a public build under sign-in", async () => {
    const { app } = await seed({ auth: true, publicBuilds: true });
    expect(await page(app, "src/Button.stories.tsx")).toContain("data-preview-load");
  });
});

describe("component page with testing", () => {
  it("keeps the catalog tabs and says a file nothing captured has no states yet", async () => {
    const { app } = await seed({ testing: true });
    const html = await page(app, "src/Button.stories.tsx");
    expect(html).toContain("data-preview-load");
    const states = await page(app, "src/Button.stories.tsx?tab=states");
    expect(states).toContain("Not captured yet");
    expect(states).toContain("?tab=design");
  });

  it("opens on States once the file was captured, and still offers the catalog's Stories", async () => {
    const { app, db, project, b2 } = await seed({ testing: true });
    await db.insert(db.tables.snapshots, {
      id: "s1",
      projectId: project.id,
      buildId: b2.id,
      storyId: "button--primary",
      storyName: "Main",
      storyTitle: "Design/Button",
      storyImportPath: BUTTON,
      screenshotPath: "x.png",
      status: "changed",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    } as never);
    const html = await page(app, "src/Button.stories.tsx");
    expect(html).toContain("Design/Button");
    expect(html).toContain('id="button--primary"');
    expect(html).toContain("changed");
    const stories = await page(app, "src/Button.stories.tsx?tab=stories");
    expect(stories).toContain(">Tertiary<");
    const history = await page(app, "src/Button.stories.tsx?tab=history");
    expect(history).toContain("Captured builds");
    expect(history).toContain("Published builds");
  });
});
