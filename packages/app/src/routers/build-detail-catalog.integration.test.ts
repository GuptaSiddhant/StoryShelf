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
  const project = await createTestProject(db, db.tables, { name: "web" });
  const created = await createTestBuild(db, db.tables, project.id);
  // `reviewing` is only reached from `capturing`, as a run finalizes.
  if (options.status === "reviewing") await new BuildModel(db).setStatus(created.id, "capturing");
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
  await (await app.request(`/projects/app/builds/${id}/diff`)).text();

describe("build page without testing", () => {
  it("labels an accepted build with no attempts Published and counts components and stories", async () => {
    const { app, build } = await seed();
    const html = await page(app, build.id);
    expect(html).toContain("Published");
    expect(html).toContain("Components");
    expect(html).toContain("Stories");
    expect(html).toMatch(/Components<\/dt><dd[^>]*>\s*2/u);
    expect(html).toMatch(/Stories<\/dt><dd[^>]*>\s*3/u);
    expect(html).toContain("Open Storybook");
  });

  it("shows no snapshot, capture or review controls", async () => {
    const { app, build } = await seed();
    const html = await page(app, build.id);
    for (const gone of [
      "Retry capture",
      "Cancel build",
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
    expect(html).toContain("Queued");
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
    expect((await app.request("/projects/app/builds/nope/diff")).status).toBe(404);
  });
});

describe("build page with testing", () => {
  it.each(["pending", "capturing", "comparing"])(
    "offers Cancel build while the build is %s",
    async (status) => {
      const { app, build } = await seed({ testing: true, status });
      expect(await page(app, build.id)).toContain("Cancel build");
    },
  );

  it.each(["reviewing", "approved", "rejected", "failed"])(
    "offers no Cancel build once the build is %s",
    async (status) => {
      const { app, build } = await seed({ testing: true, status });
      expect(await page(app, build.id)).not.toContain("Cancel build");
    },
  );

  it("keeps the snapshot sections and adds the catalog counts", async () => {
    const { app, build } = await seed({ testing: true });
    const html = await page(app, build.id);
    expect(html).not.toContain("Review diffs");
    expect(html).toContain("Retry capture");
    expect(html).toContain("Published without capture");
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

describe("the old build overview URL", () => {
  it("redirects to the build page and keeps the query string", async () => {
    const { app, build } = await seed({ testing: true });
    const plain = await app.request(`/projects/app/builds/${build.id}`);
    expect(plain.status).toBe(302);
    expect(plain.headers.get("location")).toBe(`/projects/app/builds/${build.id}/diff`);
    const withQuery = await app.request(`/projects/app/builds/${build.id}?snapshot=s1&x=a%20b`);
    expect(withQuery.headers.get("location")).toBe(
      `/projects/app/builds/${build.id}/diff?snapshot=s1&x=a%20b`,
    );
  });

  it("redirects without testing too, since the build page is classed both", async () => {
    const { app, build } = await seed();
    expect((await app.request(`/projects/app/builds/${build.id}`)).status).toBe(302);
  });
});

describe("the build page header", () => {
  it("puts Retry capture on the strip and in the empty state of a failed build, not in the menu", async () => {
    const { app, build } = await seed({ testing: true, status: "failed" });
    const html = await page(app, build.id);
    expect(html.match(/Retry capture/gu)).toHaveLength(2);
    expect(html).toContain("Show log");
    expect(html).toContain("Open Storybook");
  });

  it("offers Retry capture once, in the menu, while a build is running", async () => {
    const { app, build } = await seed({ testing: true, status: "capturing" });
    expect((await page(app, build.id)).match(/Retry capture/gu)).toHaveLength(1);
  });

  it("names the status in the strip and puts the catalog counts in the details", async () => {
    const { app, build } = await seed();
    const html = await page(app, build.id);
    expect(html).toContain("Published");
    expect(html).toMatch(/Components<\/dt><dd[^>]*>\s*2/u);
  });
});
