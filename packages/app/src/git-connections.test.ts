import type { ResolvedShelfOptions } from "@storyshelf/core/config";
import { gitlabGroup } from "@storyshelf/core/integrations";
import { createShelfLogger } from "@storyshelf/core/logger";
import { GitRepositoryLinkModel, ProjectModel } from "@storyshelf/core/models";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { runBootTasks } from "./boot-tasks.ts";
import { gitConnectionsOf, syncGitLinks } from "./git-connections.ts";
import type { LifecycleCell } from "./lifecycle.ts";
import type { ServerRuntime } from "./runtime.ts";

const logger = createShelfLogger({ level: "silent" });
const CONFIG = { secret: "test-secret-0123456789abcdef" };
const GITLAB = gitlabGroup({
  id: "gl",
  host: "https://gitlab.example.com",
  token: "glpat-x",
  expiresOn: "2099-01-01",
});

async function setup() {
  const { db } = makeDatabase();
  const project = await new ProjectModel(db).create({ name: "Web" });
  const options = {
    database: db,
    git: {
      connections: [GITLAB],
      links: [{ connection: "gl", project: project.slug, repository: "grp/sub/web" }],
    },
  } as unknown as ResolvedShelfOptions;
  return { db, project, options };
}

describe("gitConnectionsOf", () => {
  it("serves the configured connections, managed by configuration", async () => {
    const { options } = await setup();
    expect(await gitConnectionsOf(options, CONFIG).get("gl")).toMatchObject({
      provider: "gitlab-token",
      managed: true,
    });
    const none = { database: options.database } as ResolvedShelfOptions;
    expect(await gitConnectionsOf(none, CONFIG).list()).toEqual([]);
  });
});

describe("syncGitLinks", () => {
  it("creates the configured links approved, with a GitLab group path as the owner", async () => {
    const { db, project, options } = await setup();
    const result = await syncGitLinks(options, CONFIG, logger);
    expect(result.managed).toHaveLength(1);
    expect(await new GitRepositoryLinkModel(db).list(project.id)).toEqual([
      expect.objectContaining({
        state: "approved",
        host: "gitlab.example.com",
        owner: "grp/sub",
        repo: "web",
      }),
    ]);
  });

  it("runs at boot before the git state of open builds is asked again", async () => {
    const { db, project, options } = await setup();
    const order: string[] = [];
    const links = new GitRepositoryLinkModel(db);
    const request = vi.fn(async () => {
      order.push(`request:${(await links.list(project.id)).length}`);
    });
    await new (
      await import("@storyshelf/core/models")
    ).BuildModel(db).create(project.id, {
      gitSha: "a".repeat(40),
      gitBranch: "x",
    });
    const cell: LifecycleCell = {
      ready: Promise.resolve({ ok: true, failures: [] }),
      settled: null,
      consumer: null,
    };
    runBootTasks(
      cell,
      options,
      {
        config: CONFIG,
        logger,
        notifiers: [{}],
        publicOrigin: { url: async () => await Promise.resolve("https://shelf.example") },
      } as unknown as ServerRuntime,
      { request } as never,
    );
    await Promise.all(cell.background ?? []);
    expect(order).toEqual(["request:1"]);
  });

  it("logs and carries on when the sync fails at boot", async () => {
    const { options } = await setup();
    const warn = vi.fn();
    const broken = {
      ...options,
      database: {
        ...options.database,
        list: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    };
    const cell: LifecycleCell = {
      ready: Promise.resolve({ ok: true, failures: [] }),
      settled: null,
      consumer: null,
    };
    runBootTasks(
      cell,
      broken as unknown as ResolvedShelfOptions,
      {
        config: CONFIG,
        logger: { ...logger, warn, info: vi.fn(), child: () => logger },
        notifiers: [],
        publicOrigin: { url: async () => await Promise.resolve() },
      } as unknown as ServerRuntime,
    );
    await Promise.all(cell.background ?? []);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "could not apply the configured git links",
    );
  });
});
