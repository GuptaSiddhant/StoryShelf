import { describe, expect, it, vi } from "vitest";
import type { BuildReferenceLifecycle, DatabaseAdapter } from "../adapters/database.ts";
import type { Logger } from "../logger.ts";
import { makeDatabase, makeStorage } from "../test-helpers/index.ts";
import { storybookDir } from "../utils/paths.ts";
import { collectUnreferencedContent } from "./content-gc.ts";

const GOOD = "a".repeat(64);
const LIVE = "b".repeat(64);
const EVIL = "../p1/builds/b1/storybook/index.html";

function world(claimed: string[]) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const lifecycle = {
    claimContent: vi.fn(async () => await Promise.resolve(claimed)),
    holdsContentClaim: vi.fn(async () => await Promise.resolve(true)),
    finishContentCollection: vi.fn(async () => await Promise.resolve()),
    abandonContentClaim: vi.fn(async () => await Promise.resolve()),
  };
  const warn = vi.fn();
  const logger = { warn } as unknown as Logger;
  const deps = {
    db: db as DatabaseAdapter,
    storage,
    lifecycle: lifecycle as unknown as BuildReferenceLifecycle,
    logger,
  };
  const deleteSpy = vi.spyOn(storage, "delete");
  return { deps, objects, lifecycle, warn, deleteSpy };
}

describe("collectUnreferencedContent with a malformed hash", () => {
  it("never deletes it, gives its claim back, logs once without the value, and still collects the rest", async () => {
    const w = world([EVIL, GOOD]);
    const page = `${storybookDir("p1", "b1")}/index.html`;
    w.objects.set(page, Buffer.from("published"));
    w.objects.set(`content/${GOOD}`, Buffer.from("x"));

    const removed = await collectUnreferencedContent(w.deps);

    expect(removed).toBe(1);
    expect(w.objects.has(page)).toBe(true);
    expect(w.objects.has(`content/${GOOD}`)).toBe(false);
    expect(w.deleteSpy.mock.calls.map(([key]) => key)).not.toContain(EVIL);
    expect(w.lifecycle.abandonContentClaim).toHaveBeenCalledWith(EVIL, expect.any(String));
    expect(w.lifecycle.finishContentCollection).toHaveBeenCalledTimes(1);
    const skipped = w.warn.mock.calls.filter(
      ([, message]) => message === "content collection skipped",
    );
    expect(skipped).toHaveLength(1);
    expect(JSON.stringify(w.warn.mock.calls)).not.toContain(EVIL);
  });

  it("touches nothing when every claimed value is malformed", async () => {
    const w = world([EVIL, ".."]);
    expect(await collectUnreferencedContent(w.deps)).toBe(0);
    expect(w.deleteSpy).not.toHaveBeenCalled();
    expect(w.lifecycle.abandonContentClaim).toHaveBeenCalledTimes(2);
  });

  it("leaves a well-formed claimed blob alone when a live build names it", async () => {
    const w = world([LIVE]);
    await w.deps.db.insert(w.deps.db.tables.builds, {
      id: "b1",
      projectId: "p1",
      gitSha: "s",
      gitBranch: "main",
      status: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    w.objects.set(
      `${storybookDir("p1", "b1")}/manifest.json`,
      Buffer.from(JSON.stringify({ a: LIVE })),
    );
    w.objects.set(`content/${LIVE}`, Buffer.from("x"));
    expect(await collectUnreferencedContent(w.deps)).toBe(0);
    expect(w.objects.has(`content/${LIVE}`)).toBe(true);
  });
});
