import { BuildComponentModel, BuildModel } from "@storyshelf/core/models";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import { catalogPath, storybookDir } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

const index = {
  v: 5,
  entries: {
    "components-button--primary": {
      type: "story",
      id: "components-button--primary",
      name: "Primary",
      title: "Components/Button",
      importPath: "./src/Button.stories.tsx",
      tags: ["dev", "beta"],
    },
    "components-button--docs": {
      type: "docs",
      id: "components-button--docs",
      name: "Docs",
      title: "Components/Button",
      importPath: "./src/Button.stories.tsx",
    },
    "components-card--basic": {
      type: "story",
      id: "components-card--basic",
      name: "Basic",
      title: "Components/Card",
      importPath: "./src/Card.stories.tsx",
    },
  },
};

async function hostingOnlyApp(options: { testing?: boolean; status?: string } = {}) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const project = await createTestProject(db, db.tables, { name: "lib" });
  const created = await createTestBuild(db, db.tables, project.id);
  const build = await new BuildModel(db).setStatus(
    created.id,
    (options.status ?? "approved") as never,
  );
  objects.set(
    `${storybookDir(project.id, build.id)}/index.json`,
    Buffer.from(JSON.stringify(index)),
  );
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    ...(options.testing ? { testing: { runner: stubRunner() } } : {}),
  });
  return { db, storage, objects, project, build, app };
}

describe("library without testing", () => {
  it("lists components from the catalog with story counts, tags, docs and component links", async () => {
    const { app, build } = await hostingOnlyApp();
    const response = await app.request("/projects/lib/library");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Components/Button");
    expect(body).toContain("Components/Card");
    expect(body).toContain("2 components");
    expect(body).toContain("2 stories");
    expect(body).toContain('href="/projects/lib/components/src/Button.stories.tsx"');
    expect(body).toContain("beta");
    expect(body).not.toMatch(/>dev</u);
    expect(body).toContain("viewMode=docs");
    expect(body).toContain(`storyId=components-button--primary`);
    expect(body).toContain(`/projects/lib/storybook/build/${build.id}`);
    expect(body).not.toContain("/snapshots/");
  });

  it("catalogues a build published before the catalog on first view", async () => {
    const { app, db, build, objects, project } = await hostingOnlyApp();
    expect(objects.has(catalogPath(project.id, build.id))).toBe(false);
    await app.request("/projects/lib/library");
    expect(objects.has(catalogPath(project.id, build.id))).toBe(true);
    const rows = await new BuildComponentModel(db).listByBuild(build.id);
    expect(rows.map((row) => row.title)).toEqual(["Components/Button", "Components/Card"]);
  });

  it("shows the latest build of the branch whatever its status", async () => {
    const { app, db, project, objects, build } = await hostingOnlyApp();
    const newer = await createTestBuild(db, db.tables, project.id, { gitSha: "sha-new" });
    await db.update(db.tables.builds, newer.id, { createdAt: "2999-01-01T00:00:00.000Z" } as never);
    objects.set(
      `${storybookDir(project.id, newer.id)}/index.json`,
      Buffer.from(
        JSON.stringify({ entries: { "x--y": { id: "x--y", title: "Only/New", name: "Y" } } }),
      ),
    );
    const body = await (await app.request("/projects/lib/library")).text();
    expect(body).toContain("Only/New");
    expect(body).toContain("pending");
    expect(body).not.toContain("Components/Button");
    expect(build.id).not.toBe(newer.id);
  });

  it("follows the branch switcher and falls back to the default branch", async () => {
    const { app, db, project, objects } = await hostingOnlyApp();
    const feature = await createTestBuild(db, db.tables, project.id, {
      gitSha: "sha-f",
      gitBranch: "feature/x",
    });
    objects.set(
      `${storybookDir(project.id, feature.id)}/index.json`,
      Buffer.from(
        JSON.stringify({ entries: { "f--a": { id: "f--a", title: "Feature/Only", name: "A" } } }),
      ),
    );
    const picked = await (await app.request("/projects/lib/library?branch=feature%2Fx")).text();
    expect(picked).toContain("Feature/Only");
    expect(picked).toContain("feature/x");
    const unknown = await (await app.request("/projects/lib/library?branch=nope")).text();
    expect(unknown).toContain("Components/Button");
  });

  it("says a pending build with no index yet is being prepared", async () => {
    const { app, objects, build, project } = await hostingOnlyApp({ status: "pending" });
    objects.delete(`${storybookDir(project.id, build.id)}/index.json`);
    const body = await (await app.request("/projects/lib/library")).text();
    expect(body).toContain("Preparing the library");
  });

  it("explains a build whose Storybook index is gone", async () => {
    const { app, objects, build, project } = await hostingOnlyApp();
    objects.delete(`${storybookDir(project.id, build.id)}/index.json`);
    const body = await (await app.request("/projects/lib/library")).text();
    expect(body).toContain("No stories in the latest build");
  });

  it("renders for a project with no builds, and 404s for an unknown one", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await createTestProject(db, db.tables, { name: "empty" });
    const app = createShelfApp({ database: db, storage, logger: pino({ level: "silent" }) });
    expect(await (await app.request("/projects/empty/library")).text()).toContain("No builds yet");
    expect((await app.request("/projects/none/library")).status).toBe(404);
  });
});

describe("library with testing", () => {
  it("layers snapshots, statuses and the review link onto the catalog's components", async () => {
    const { app, db, project, build } = await hostingOnlyApp({ testing: true });
    await db.insert(db.tables.snapshots, {
      id: "snap1",
      projectId: project.id,
      buildId: build.id,
      storyId: "components-button--primary",
      storyName: "Primary",
      storyTitle: "Components/Button",
      storyImportPath: "./src/Button.stories.tsx",
      screenshotPath: "x.png",
      status: "changed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never);
    const body = await (await app.request("/projects/lib/library")).text();
    expect(body).toContain("/snapshots/snap1/image");
    expect(body).toContain("changed");
    // the uncaptured Card story is still listed from the catalog
    expect(body).toContain("Components/Card");
    expect(body).toContain("storyId=components-card--basic");
  });

  it("keeps the catalog skeleton when nothing was captured yet", async () => {
    const { app } = await hostingOnlyApp({ testing: true });
    const body = await (await app.request("/projects/lib/library")).text();
    expect(body).toContain("Components/Button");
    expect(body).not.toContain("/snapshots/");
  });

  it("does not show snapshots of an instance that has no testing", async () => {
    const { app, db, project, build } = await hostingOnlyApp();
    await db.insert(db.tables.snapshots, {
      id: "snap1",
      projectId: project.id,
      buildId: build.id,
      storyId: "components-button--primary",
      storyName: "Primary",
      storyTitle: "Components/Button",
      storyImportPath: "./src/Button.stories.tsx",
      screenshotPath: "x.png",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never);
    expect(await (await app.request("/projects/lib/library")).text()).not.toContain("/snapshots/");
  });
});
