import type { Viewport } from "@storyshelf/core/adapter/capture-runner";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { StorybookAdapter } from "@storyshelf/core/capture";
import { isDisabledStory } from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";
import {
  ProjectModel,
  BuildModel,
  SnapshotModel,
  BaselineModel,
  LabelModel,
} from "@storyshelf/core/models";
import {
  projects,
  builds,
  snapshots,
  baselines,
  buildLabels,
  labelTypes,
} from "@storyshelf/db-sqlite/schema";
// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEMO_SLUG = "demo-design-system";
const DEMO_NAME = "Demo Design System";
const DEMO_REPO = "acme/design-system";
const VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "mobile", width: 375, height: 667 },
];

function resolveStorybookDir(): string | null {
  const candidates = [
    resolve("fixtures/storybook-8/storybook-static"),
    resolve(process.cwd(), "fixtures/storybook-8/storybook-static"),
    join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/storybook-8/storybook-static"),
    "/app/fixtures/storybook-8/storybook-static",
  ];
  for (const p of candidates) {
    if (existsSync(join(p, "index.json")) || existsSync(join(p, "stories.json"))) return p;
  }
  return null;
}

/** Seed or override the single demo project — other projects untouched. Always called, serve irrespective of failure. */
export async function seedDemo(options: {
  database: DatabaseAdapter;
  storage: StorageAdapter;
  captureRunner: { render: (input: unknown) => Promise<unknown> };
  logger?: Logger;
}): Promise<void> {
  const { database, storage, captureRunner, logger } = options;
  const log = logger?.child?.({ seed: DEMO_SLUG }) ?? logger;
  try {
    const tables = { projects, builds, snapshots, baselines, buildLabels, labelTypes };
    const projectModel = new ProjectModel(database, { projects });
    let project = await projectModel.getBySlug(DEMO_SLUG);

    if (!project) {
      project = await projectModel.create({
        name: DEMO_NAME,
        gitRepository: DEMO_REPO,
        gitDefaultBranch: "main",
      });
      // Force slug to DEMO_SLUG (create() slugifies name → demo-design-system already)
      if (project.slug !== DEMO_SLUG) {
        await database.update(projects, project.id, {
          slug: DEMO_SLUG,
          updatedAt: new Date().toISOString(),
        });
        project = (await projectModel.getBySlug(DEMO_SLUG)) ?? project;
      }
      await new LabelModel(database, { builds, buildLabels, labelTypes }).seedFor(project.id);
      log?.info({ projectId: project.id }, "seed demo project created");
    } else {
      log?.info({ projectId: project.id }, "seed demo project exists — overriding builds");
    }

    // Purge only this demo project's builds/baselines/storage — other projects untouched
    const buildModel = new BuildModel(database, { builds, buildLabels, labelTypes });
    const allBuilds = (await database.list(builds)) as unknown as {
      id: string;
      projectId: string;
    }[];
    const existingBuilds = allBuilds.filter((b) => b.projectId === project.id);
    for (const b of existingBuilds) {
      const prefix = `${project.id}/builds/${b.id}/`;
      try {
        const keys = await storage.list(prefix);
        for (const key of keys) await storage.delete(key).catch(() => {});
      } catch {}
      await buildModel.remove(b.id).catch(() => {});
    }
    // Remove demo baselines for both branches to start fresh
    const baselineModel = new BaselineModel(
      database,
      { baselines },
      storage,
      process.env["SECRET"],
    );
    const allBaselines = (await database.list(baselines)) as unknown as {
      id: string;
      projectId: string;
      screenshotPath: string;
    }[];
    const existingBaselines = allBaselines.filter((bl) => bl.projectId === project.id);
    for (const bl of existingBaselines) {
      await storage.delete(bl.screenshotPath).catch(() => {});
      await database.remove(baselines, bl.id).catch(() => {});
    }

    // Discover fixture-8 stories
    const storybookDir = resolveStorybookDir();
    if (!storybookDir) {
      log?.warn("seed demo: storybook-static not found — seeding with dummy snapshots");
      // Fallback: create dummy build without real renders (keeps demo visible)
      const fallbackBuild = await buildModel.create(project.id, {
        gitSha: "abc123def4567890abc123def4567890abc12345",
        gitBranch: "feature/new-button",
        authorName: "Alex Doe",
        authorEmail: "alex@example.com",
        message: "feat: demo seed (fallback)",
      });
      await database.update(builds, fallbackBuild.id, { status: "reviewing" } as never);
      return;
    }

    const adapter = new StorybookAdapter();
    const discovered = await adapter.discover(storybookDir);
    const stories = discovered
      .filter((s) => !isDisabledStory(s))
      .map((s) =>
        s.id === "components-button--blocking-failure"
          ? { ...s, tags: [...(s.tags ?? []), "flaky-test"] }
          : s,
      );
    if (stories.length === 0) {
      log?.warn("seed demo: no stories discovered");
      return;
    }
    log?.info({ storyCount: stories.length, storybookDir }, "seed demo stories discovered");

    // Create reviewing build
    const build = await buildModel.create(project.id, {
      gitSha: "abc123def4567890abc123def4567890abc12345",
      gitBranch: "feature/new-button",
      authorName: "Alex Doe",
      authorEmail: "alex@example.com",
      message: "feat: add primary button variant with new tokens",
    });
    await database.update(builds, build.id, { status: "reviewing" } as never);

    // Real renders via capture runner
    const result = (await (
      captureRunner as unknown as {
        render: (input: {
          buildId: string;
          storybookDir: string;
          stories: typeof stories;
          viewports: Viewport[];
          logger?: Logger;
        }) => Promise<{
          captures: {
            story: (typeof stories)[number];
            viewportName: string;
            viewport?: Viewport;
            screenshot: Buffer;
          }[];
          failures: unknown[];
        }>;
      }
    ).render({
      buildId: build.id,
      storybookDir,
      stories,
      viewports: VIEWPORTS,
      logger: log,
    })) as {
      captures: {
        story: (typeof stories)[number];
        viewportName: string;
        viewport?: Viewport;
        screenshot: Buffer;
      }[];
    };

    // Persist via pipeline helpers (simplified — write screenshots/diffs, create snapshots, baselines)
    const snapModel = new SnapshotModel(database, { snapshots });
    for (const cap of result.captures) {
      const vp = VIEWPORTS.find((v) => v.name === cap.viewportName) ?? VIEWPORTS[0];
      const screenshotPath = `${project.id}/builds/${build.id}/screenshots/${cap.story.id}/${cap.viewportName}.png`;
      await storage.write(screenshotPath, cap.screenshot);
      // For demo, create diff overlay as same image (or empty) — pipeline will diff against baseline later
      const snap = await snapModel.create(project.id, build.id, {
        storyId: cap.story.id,
        storyName: cap.story.name,
        storyTitle: cap.story.title,
        storyImportPath: cap.story.importPath ?? "src/Button.stories.tsx",
        viewportName: cap.viewportName,
        viewportWidth: vp.width,
        viewportHeight: vp.height,
        screenshotPath,
      });
      await snapModel.setStatus(snap.id, "changed");
    }

    // Baseline for primary on main (first story)
    if (result.captures.length > 0) {
      const first = result.captures[0];
      const baselinePath = `${project.id}/baselines/main/${first.story.id}/${first.viewportName}.png`;
      await storage.write(baselinePath, first.screenshot);
      await baselineModel.upsert(
        project.id,
        first.story.id,
        first.viewportName,
        "main",
        first.story.id,
        baselinePath,
        first.screenshot,
      );
    }

    // Ensure preview iframe is available — copy fixture static into storage at storybookDir for this build
    try {
      const { persistStorybookStatics } = await import("@storyshelf/core/capture");
      await persistStorybookStatics(storage, storybookDir, project.id, build.id);
      log?.info({ storybookDir }, "seed demo statics persisted");
    } catch (error) {
      log?.warn(
        { err: error as Error },
        "seed demo statics persist failed — preview will stay Preparing until retry",
      );
    }

    // Update build counts
    await database.update(builds, build.id, {
      status: "reviewing",
      snapshotCount: result.captures.length,
      changedCount: result.captures.length,
      updatedAt: new Date().toISOString(),
    } as never);

    log?.info({ buildId: build.id, captures: result.captures.length }, "seed demo build ready");
  } catch (error) {
    log?.error({ err: error }, "seed demo failed — serving irrespective");
  }
}
