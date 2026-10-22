import { catalogueBuild } from "@storyshelf/core/capture";
import { BuildModel, LabelModel } from "@storyshelf/core/models";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import { storybookDir } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

const index = {
  v: 5,
  entries: {
    "button--primary": {
      id: "button--primary",
      title: "Button",
      name: "Primary",
      importPath: "./Button.tsx",
    },
    "button--secondary": {
      id: "button--secondary",
      title: "Button",
      name: "Secondary",
      importPath: "./Button.tsx",
    },
    "button--docs": {
      id: "button--docs",
      title: "Button",
      name: "Docs",
      importPath: "./Button.tsx",
      type: "docs",
    },
    "card--basic": { id: "card--basic", title: "Card", name: "Basic", importPath: "./Card.tsx" },
  },
};

async function seed(options: { testing?: boolean; status?: string; catalogued?: boolean } = {}) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const project = await createTestProject(db, db.tables, { name: "app" });
  const created = await createTestBuild(db, db.tables, project.id);
  const build = await new BuildModel(db).setStatus(
    created.id,
    (options.status ?? "approved") as never,
  );
  if (options.catalogued !== false) {
    objects.set(
      `${storybookDir(project.id, build.id)}/index.json`,
      Buffer.from(JSON.stringify(index)),
    );
    await catalogueBuild({ db, storage }, project.id, build.id);
  }
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    ...(options.testing ? { testing: { runner: stubRunner() } } : {}),
  });
  return { app, db, project, build, objects };
}

const page = async (app: Awaited<ReturnType<typeof seed>>["app"], id: string) =>
  await (await app.request(`/projects/app/builds/${id}`)).text();

describe("build page without testing", () => {
  it("labels an accepted build with no attempts Published and counts components and stories", async () => {
    const { app, build } = await seed();
    const html = await page(app, build.id);
    expect(html).toContain("Published");
    expect(html).toContain("Components");
    expect(html).toContain("Stories");
    expect(html).toMatch(/>2<\/div><div[^>]*>Components</u);
    expect(html).toMatch(/>3<\/div><div[^>]*>Stories</u);
    expect(html).toContain("View Storybook");
  });

  it("shows no snapshot, capture or review controls", async () => {
    const { app, build } = await seed();
    const html = await page(app, build.id);
    for (const gone of [
      "Review diffs",
      "Retry capture",
      "No snapshots yet",
      "Capture attempts",
      "Changed / new",
      "full capture",
    ]) {
      expect(html).not.toContain(gone);
    }
    expect(html).toContain("Comments");
  });

  it("keeps the status of a build that is not accepted yet", async () => {
    const { app, build } = await seed({ status: "pending" });
    const html = await page(app, build.id);
    expect(html).not.toContain("Published");
    expect(html).toContain("pending");
  });

  it("shows the build's labels", async () => {
    const { app, db, project, build } = await seed();
    await new LabelModel(db).seedFor(project.id);
    await new LabelModel(db).attach(project.id, build.id, "release", "v1");
    expect(await page(app, build.id)).toContain("v1");
  });

  it("omits the counts of a build with no catalog, and 404s for an unknown build", async () => {
    const { app, build } = await seed({ catalogued: false });
    const html = await page(app, build.id);
    expect(html).not.toContain("Components");
    expect((await app.request("/projects/app/builds/nope")).status).toBe(404);
  });
});

describe("build page with testing", () => {
  it("keeps the snapshot sections and adds the catalog counts", async () => {
    const { app, build } = await seed({ testing: true });
    const html = await page(app, build.id);
    expect(html).toContain("Review diffs");
    expect(html).toContain("Retry capture");
    expect(html).toContain("Changed / new");
    expect(html).toContain("No snapshots yet");
    expect(html).toContain("Components");
  });

  it("labels a build with attempts by its status, not Published", async () => {
    const { app, db, project, build } = await seed({ testing: true });
    await db.insert(db.tables.captureAttempts, {
      id: "a1",
      projectId: project.id,
      buildId: build.id,
      attemptNo: 1,
      status: "done",
      storyCount: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never);
    const html = await page(app, build.id);
    expect(html).not.toContain(">Published<");
    expect(html).toContain("Capture attempts");
  });
});
