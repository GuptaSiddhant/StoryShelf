import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { projectStatusConfigs } from "../../../db-sqlite/src/schema/index.ts";
import type { GitHostAdapter, GitHostProvider } from "../adapters/git-host/index.ts";
import { StatusConfigModel } from "../models/status-config.ts";
import type { Project } from "../schema/project.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { postStatusesForBuild } from "./status-fanout.ts";

const SECRET = "test-secret-0123456789abcdef";

function tables() {
  return { projectStatusConfigs: projectStatusConfigs as unknown as never };
}

function fakeProvider(setStatus: ReturnType<typeof vi.fn>): GitHostProvider {
  const adapter: GitHostAdapter = {
    metadata: {
      name: "Fake Git",
      version: "0.0.0",
      kind: "fake-git",
      category: "git-host",
      schema: z.object({}),
    },
    setStatus: setStatus as GitHostAdapter["setStatus"],
  };
  return {
    metadata: {
      name: "Fake Git",
      version: "0.0.0",
      kind: "fake-git",
      category: "git-host",
      schema: z.object({}),
    },
    create: () => adapter,
  };
}

const project = { id: "p1", slug: "demo" } as Project;

async function setup(): Promise<{
  db: ReturnType<typeof makeDatabase>["db"];
  setStatus: ReturnType<typeof vi.fn>;
  providers: GitHostProvider[];
}> {
  const { db } = makeDatabase();
  await new StatusConfigModel(db, tables(), SECRET).create(project.id, {
    provider: "fake-git",
    config: {},
    token: "token",
  });
  const setStatus = vi.fn(async () => {
    await Promise.resolve();
  });
  return { db, setStatus, providers: [fakeProvider(setStatus)] };
}

function post(
  db: ReturnType<typeof makeDatabase>["db"],
  providers: GitHostProvider[],
  sha: string,
) {
  return postStatusesForBuild({
    db,
    tables: tables(),
    project,
    sha,
    status: "success",
    url: "https://shelf.example.com/builds/b1",
    providers,
    secret: SECRET,
  });
}

describe("postStatusesForBuild", () => {
  it("posts to providers for real shas", async () => {
    const { db, setStatus, providers } = await setup();
    await post(db, providers, "abc123def456");
    expect(setStatus).toHaveBeenCalledTimes(1);
  });

  it("skips providers for synthetic local shas", async () => {
    const { db, setStatus, providers } = await setup();
    await post(db, providers, "local-a1b2c3d4e5f6");
    expect(setStatus).not.toHaveBeenCalled();
  });
});
