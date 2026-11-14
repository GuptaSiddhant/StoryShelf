import type { BuildStatePublisher } from "@storyshelf/core/capture";
import { BuildModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { requestBuildState } from "./git-status.ts";
import { runWithStore, type Store } from "./store.ts";

/** A store whose publisher records every build it is asked about. */
function storeWith(db: ReturnType<typeof makeDatabase>["db"], requested: string[]): Store {
  const buildState = {
    request: vi.fn((buildId: string) => {
      requested.push(buildId);
      return Promise.resolve();
    }),
  } as unknown as BuildStatePublisher;
  return {
    db,
    storage: makeStorage().storage,
    logger: pino({ level: "silent" }),
    buildState,
  } as unknown as Store;
}

describe("requestBuildState follows the source (ADR 0044, decision 6)", () => {
  it("asks for the builds skipped from a build too, newest first", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db);
    const source = await model.create("p1", { gitSha: "a", gitBranch: "main" });
    await model.setStatus(source.id, "approved");
    const first = await model.createSkipped({
      projectId: "p1",
      gitSha: "b",
      gitBranch: "main",
      sourceBuildId: source.id,
      changedFiles: [],
    });
    const second = await model.createSkipped({
      projectId: "p1",
      gitSha: "c",
      gitBranch: "main",
      sourceBuildId: first.id,
      changedFiles: [],
    });
    const requested: string[] = [];
    await runWithStore(storeWith(db, requested), () => requestBuildState(source.id));
    expect(requested.toSorted()).toEqual([source.id, first.id, second.id].toSorted());
    expect(requested[0]).toBe(source.id);
  });

  it("asks for a build with no followers once", async () => {
    const { db } = makeDatabase();
    const build = await new BuildModel(db).create("p1", { gitSha: "a", gitBranch: "main" });
    const requested: string[] = [];
    await runWithStore(storeWith(db, requested), () => requestBuildState(build.id));
    expect(requested).toEqual([build.id]);
  });

  it("never rejects when the follower lookup fails", async () => {
    const { db } = makeDatabase();
    const requested: string[] = [];
    const store = storeWith(db, requested);
    vi.spyOn(db, "list").mockRejectedValueOnce(new Error("db down"));
    await expect(runWithStore(store, () => requestBuildState("b1"))).resolves.toBeUndefined();
    expect(requested).toEqual(["b1"]);
  });
});
