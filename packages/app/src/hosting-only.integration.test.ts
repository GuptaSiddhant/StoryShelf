import { BuildModel, ProjectModel, SnapshotModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countHiddenSnapshots } from "./hidden-data.ts";
import { createShelfApp } from "./index.tsx";
import { stubRunner } from "./test-runner.ts";

type Db = ReturnType<typeof makeDatabase>["db"];

afterEach(() => {
  vi.unstubAllEnvs();
});

async function seedSnapshot(db: Db): Promise<{ slug: string }> {
  const project = await new ProjectModel(db).create({ name: "Docs" });
  const build = await new BuildModel(db).create(project.id, { gitSha: "abc", gitBranch: "main" });
  await new SnapshotModel(db).create(project.id, build.id, {
    storyId: "button--primary",
    storyName: "Primary",
    storyTitle: "Button",
    viewportName: "desktop",
    viewportWidth: 1280,
    viewportHeight: 720,
    screenshotPath: "screenshots/primary.png",
  });
  return { slug: project.slug };
}

function boot(db: Db, testing: boolean, logger = pino({ level: "silent" })) {
  const { storage } = makeStorage();
  return createShelfApp({
    database: db,
    storage,
    logger,
    ...(testing ? { testing: { runner: stubRunner() } } : {}),
  });
}

describe("hosting-only System page", () => {
  it("says testing is off and counts the snapshots it hides", async () => {
    const { db } = makeDatabase();
    await seedSnapshot(db);
    const app = boot(db, false);
    await app.lifecycle.setup();
    const html = await (await app.request("/admin")).text();
    expect(html).toContain("Testing is off: Storybook hosting only");
    expect(html).toContain("1 existing snapshot(s) are hidden, not deleted");
    await app.lifecycle.teardown();
  });

  it("shows the notice without a count when nothing is hidden", async () => {
    const { db } = makeDatabase();
    const app = boot(db, false);
    await app.lifecycle.setup();
    const html = await (await app.request("/admin")).text();
    expect(html).toContain("Testing is off: Storybook hosting only");
    expect(html).not.toContain("are hidden");
    await app.lifecycle.teardown();
  });

  it("shows no notice with testing on", async () => {
    const { db } = makeDatabase();
    const app = boot(db, true);
    await app.lifecycle.setup();
    expect(await (await app.request("/admin")).text()).not.toContain("Testing is off");
    await app.lifecycle.teardown();
  });
});

describe("hosting-only navigation", () => {
  it("drops the testing tabs from project settings", async () => {
    const { db } = makeDatabase();
    const { slug } = await seedSnapshot(db);
    const hosting = boot(db, false);
    const html = await (await hosting.request(`/projects/${slug}/settings/tokens`)).text();
    for (const hidden of ["settings/capture", "settings/tests", "settings/status", "settings/ai"]) {
      expect(html).not.toContain(`/projects/${slug}/${hidden}"`);
    }
    expect(html).toContain(`/projects/${slug}/settings/tokens"`);
    await hosting.lifecycle.teardown();

    const testing = boot(db, true);
    const full = await (await testing.request(`/projects/${slug}/settings/tokens`)).text();
    expect(full).toContain(`/projects/${slug}/settings/capture"`);
    expect(full).toContain(`/projects/${slug}/settings/tests"`);
    await testing.lifecycle.teardown();
  });
});

describe("hosting-only startup log", () => {
  it("warns with the hidden snapshot count", async () => {
    const { db } = makeDatabase();
    await seedSnapshot(db);
    const lines: string[] = [];
    const logger = pino(
      { level: "info" },
      {
        write: (line: string) => {
          lines.push(line);
        },
      },
    );
    const app = boot(db, false, logger);
    await app.lifecycle.setup();
    await vi.waitFor(() => {
      expect(lines.join("")).toContain("hiddenSnapshots");
    });
    expect(lines.join("")).toContain("existing snapshots are hidden, not deleted");
    await app.lifecycle.teardown();
  });

  it("logs the mode once, without a warning, when nothing is hidden", async () => {
    const { db } = makeDatabase();
    const lines: string[] = [];
    const logger = pino(
      { level: "info" },
      {
        write: (line: string) => {
          lines.push(line);
        },
      },
    );
    const app = boot(db, false, logger);
    await app.lifecycle.setup();
    await vi.waitFor(() => {
      expect(lines.join("")).toContain("hosting Storybooks only");
    });
    expect(lines.join("")).not.toContain("hiddenSnapshots");
    await app.lifecycle.teardown();
  });

  it("stays quiet about the mode with testing on", async () => {
    const { db } = makeDatabase();
    const lines: string[] = [];
    const logger = pino(
      { level: "info" },
      {
        write: (line: string) => {
          lines.push(line);
        },
      },
    );
    const app = boot(db, true, logger);
    await app.lifecycle.setup();
    await app.lifecycle.teardown();
    expect(lines.join("")).not.toContain("testing is off");
  });
});

describe("countHiddenSnapshots", () => {
  it("counts every stored snapshot", async () => {
    const { db } = makeDatabase();
    expect(await countHiddenSnapshots(db)).toBe(0);
    await seedSnapshot(db);
    expect(await countHiddenSnapshots(db)).toBe(1);
  });
});

describe("serverless and database boot checks", () => {
  it("refuses testing on AWS Lambda, hosts there, and honours the override", () => {
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "fn");
    const { db } = makeDatabase();
    expect(() => boot(db, true)).toThrow(/AWS Lambda/u);
    expect(() => boot(db, false)).not.toThrow();
    // Handing jobs to a remote queue renders nothing in this process.
    const { storage } = makeStorage();
    const queue = {
      metadata: { name: "remote", version: "0.0.0", kind: "remote", category: "capture-queue" },
      enqueue: async () => {},
      status: async () => null,
      active: async () => [],
      recent: async () => [],
    } as never;
    expect(() => createShelfApp({ database: db, storage, testing: { queue } })).not.toThrow();
    vi.stubEnv("STORYSHELF_ALLOW_SERVERLESS", "1");
    expect(() => boot(db, true)).not.toThrow();
  });

  it("warns, without refusing, on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    const { db } = makeDatabase();
    const lines: string[] = [];
    const logger = pino(
      { level: "warn" },
      {
        write: (line: string) => {
          lines.push(line);
        },
      },
    );
    expect(() => boot(db, true, logger)).not.toThrow();
    expect(lines.join("")).toContain("serverless host");
  });

  it("refuses testing on a database that cannot back it", () => {
    const { db } = makeDatabase();
    const d1Like = {
      ...db,
      metadata: { ...db.metadata, name: "Cloudflare D1", supportsTesting: false },
    };
    const { storage } = makeStorage();
    expect(() =>
      createShelfApp({ database: d1Like, storage, testing: { runner: stubRunner() } }),
    ).toThrow(/Cloudflare D1 database cannot back testing/u);
    expect(() => createShelfApp({ database: d1Like, storage })).not.toThrow();
  });
});
