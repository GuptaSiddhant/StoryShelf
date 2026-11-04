import { describe, expect, it, vi } from "vitest";
import type { BuildReferenceLifecycle, DeletingBuild } from "../adapters/database.ts";
import { makeDatabase } from "../test-helpers/fake-database.ts";
import { makeStorage } from "../test-helpers/fake-storage.ts";
import { deleteClaimedBuild, manifestHashes } from "./build-deletion.ts";
import { purgeClaimedBuilds } from "./purge-claimed.ts";

const build = (overrides: Partial<DeletingBuild> = {}): DeletingBuild => ({
  projectId: "p",
  buildId: "b1",
  contentReleased: false,
  storageDeleted: false,
  ...overrides,
});

/** A lifecycle whose steps answer from `script` and record the calls made. */
function scriptedLifecycle(script: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const answer = (name: string, fallback: unknown) => {
    calls.push(name);
    return Promise.resolve(script[name] ?? fallback);
  };
  const lifecycle = {
    claimDeletion: () => answer("claim", "claimed"),
    listDeleting: () => answer("list", []),
    releaseBuildContent: () => answer("release", "done"),
    markStorageDeleted: () => answer("mark", "done"),
    completeDeletion: () => answer("complete", { result: undefined }),
  } as unknown as BuildReferenceLifecycle;
  return { lifecycle, calls };
}

function setup(script?: Partial<Record<string, unknown>>) {
  const { storage, objects } = makeStorage();
  const { db } = makeDatabase();
  const { lifecycle, calls } = scriptedLifecycle(script);
  return { deps: { db, storage, lifecycle }, objects, calls };
}

describe("manifestHashes", () => {
  it("names the distinct hashes of the manifest, and none without one", async () => {
    const { storage } = makeStorage();
    expect(await manifestHashes({ storage }, "p", "b1")).toEqual([]);
    await storage.write(
      "p/builds/b1/storybook/manifest.json",
      Buffer.from(JSON.stringify({ "a.js": "h1", "b.js": "h1", "c.js": "h2" })),
    );
    expect(await manifestHashes({ storage }, "p", "b1")).toEqual(["h1", "h2"]);
  });

  it("warns and names nothing for a manifest that is not JSON, so counts are kept", async () => {
    const { storage } = makeStorage();
    const warn = vi.fn();
    await storage.write("p/builds/b1/storybook/manifest.json", Buffer.from("{"));

    expect(await manifestHashes({ storage, logger: { warn } as never }, "p", "b1")).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("throws when a manifest exists but cannot be read, so the step is retried", async () => {
    const { storage } = makeStorage();
    await storage.write("p/builds/b1/storybook/manifest.json", Buffer.from("{}"));
    storage.read = () => Promise.reject(new Error("disk"));

    await expect(manifestHashes({ storage }, "p", "b1")).rejects.toThrow("disk");
  });
});

describe("deleteClaimedBuild", () => {
  it("runs the three steps in order and deletes the build's storage", async () => {
    const { deps, objects, calls } = setup();
    objects.set("p/builds/b1/storybook/index.html", Buffer.from("x"));
    objects.set("p/builds/b2/storybook/index.html", Buffer.from("y"));
    const steps: string[] = [];

    const result = await deleteClaimedBuild(
      {
        ...deps,
        afterStep: (step) => {
          steps.push(step);
        },
      },
      build(),
    );

    expect(result).toEqual({ buildId: "b1", outcome: "deleted", files: 1 });
    expect(steps).toEqual(["content", "storage", "rows"]);
    expect(calls).toEqual(["release", "mark", "complete"]);
    expect([...objects.keys()]).toEqual(["p/builds/b2/storybook/index.html"]);
  });

  it("skips the steps already recorded", async () => {
    const { deps, calls } = setup();

    await deleteClaimedBuild(deps, build({ contentReleased: true, storageDeleted: true }));

    expect(calls).toEqual(["complete"]);
  });

  it("reports a build another cleaner finished, at whichever step it notices", async () => {
    for (const step of ["release", "mark", "complete"]) {
      const { deps } = setup({ [step]: "not-deleting" });
      // oxlint-disable-next-line no-await-in-loop -- three independent cases, run in order
      expect((await deleteClaimedBuild(deps, build())).outcome).toBe("already-gone");
    }
  });

  it("refuses to run a step before the one it needs", async () => {
    await expect(deleteClaimedBuild(setup({ mark: "out-of-order" }).deps, build())).rejects.toThrow(
      "before content",
    );
    await expect(
      deleteClaimedBuild(setup({ complete: "out-of-order" }).deps, build()),
    ).rejects.toThrow("before storage");
  });
});

describe("purgeClaimedBuilds", () => {
  it("counts a protected candidate, finishes the rest, and survives one build failing", async () => {
    const { deps, calls } = setup({
      claim: "protected",
      list: [
        build({ buildId: "bad" }),
        build({ buildId: "good", contentReleased: true, storageDeleted: true }),
      ],
    });
    const warn = vi.fn();
    let failed = false;
    const lifecycle = deps.lifecycle;
    lifecycle.releaseBuildContent = () => {
      failed = true;
      return Promise.reject(new Error("boom"));
    };

    const result = await purgeClaimedBuilds(
      { ...deps, lifecycle, logger: { warn, info: vi.fn() } as never },
      "p",
      ["b1"],
    );

    expect(failed).toBe(true);
    expect(result).toEqual({ removedBuilds: 1, removedFiles: 0, protectedBuilds: 1 });
    expect(warn).toHaveBeenCalledOnce();
    expect(calls).toContain("claim");
  });

  it("skips a candidate whose claim throws and still claims the rest and finishes the others", async () => {
    const { deps } = setup({
      list: [build({ buildId: "ready", contentReleased: true, storageDeleted: true })],
    });
    const warn = vi.fn();
    const claimed: string[] = [];
    deps.lifecycle.claimDeletion = (_project, buildId) => {
      if (buildId === "locked") return Promise.reject(new Error("write lock timeout"));
      claimed.push(buildId);
      return Promise.resolve("claimed");
    };

    const result = await purgeClaimedBuilds(
      { ...deps, logger: { warn, info: vi.fn() } as never },
      "p",
      ["locked", "free"],
    );

    expect(claimed).toEqual(["free"]);
    expect(warn).toHaveBeenCalledOnce();
    expect(result.removedBuilds).toBe(1);
  });
});
