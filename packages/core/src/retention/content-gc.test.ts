import { describe, expect, it, vi } from "vitest";
import type { BuildReferenceLifecycle, DatabaseAdapter } from "../adapters/database.ts";
import type { Logger } from "../logger.ts";
import { makeDatabase, makeStorage } from "../test-helpers/index.ts";
import { storybookDir } from "../utils/paths.ts";
import { MANIFEST_READ_CONCURRENCY, collectUnreferencedContent } from "./content-gc.ts";

// The architect fixed the limit at 8: a literal here, so changing the constant fails a test.
const EIGHT = 8;

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

/** `count` live builds, each with a manifest; `name(i)` lists the hashes build `i` serves. */
async function liveBuilds(
  w: ReturnType<typeof world>,
  count: number,
  name: (index: number) => string[],
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const id = `b${String(index).padStart(3, "0")}`;
    // oxlint-disable-next-line no-await-in-loop -- seeding in order keeps the build list stable
    await w.deps.db.insert(w.deps.db.tables.builds, {
      id,
      projectId: "p1",
      gitSha: "s",
      gitBranch: "main",
      status: "approved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    w.objects.set(
      `${storybookDir("p1", id)}/manifest.json`,
      Buffer.from(
        JSON.stringify(Object.fromEntries(name(index).map((hash, at) => [`f${at}`, hash]))),
      ),
    );
  }
}

/** Make every storage read take a moment, counting how many are in flight and how many started. */
function slowReads(w: ReturnType<typeof world>) {
  const real = w.deps.storage.read.bind(w.deps.storage);
  const stats = { inFlight: 0, peak: 0, started: 0 };
  vi.spyOn(w.deps.storage, "read").mockImplementation(async (key: string) => {
    stats.started += 1;
    stats.inFlight += 1;
    stats.peak = Math.max(stats.peak, stats.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    stats.inFlight -= 1;
    return await real(key);
  });
  return stats;
}

describe("collectUnreferencedContent reading the live manifests", () => {
  it("reads eight manifests at a time: in parallel, and no more", async () => {
    const w = world([GOOD]);
    await liveBuilds(w, 40, (index) => [String(index).padStart(64, "c")]);
    w.objects.set(`content/${GOOD}`, Buffer.from("x"));
    const reads = slowReads(w);

    expect(await collectUnreferencedContent(w.deps)).toBe(1);

    // The candidate is named by no manifest, so the scan reads all 40.
    expect(reads.started).toBe(40);
    expect(MANIFEST_READ_CONCURRENCY).toBe(EIGHT);
    expect(reads.peak).toBe(EIGHT);
    expect(w.objects.has(`content/${GOOD}`)).toBe(false);
  });

  it("keeps a candidate that only the last manifest names, however the reads interleave", async () => {
    const w = world([GOOD, LIVE]);
    await liveBuilds(w, 30, (index) => (index === 29 ? [LIVE] : []));
    w.objects.set(`content/${GOOD}`, Buffer.from("x"));
    w.objects.set(`content/${LIVE}`, Buffer.from("y"));
    slowReads(w);

    expect(await collectUnreferencedContent(w.deps)).toBe(1);

    expect(w.objects.has(`content/${LIVE}`)).toBe(true);
    expect(w.objects.has(`content/${GOOD}`)).toBe(false);
    expect(w.lifecycle.abandonContentClaim).toHaveBeenCalledWith(LIVE, expect.any(String));
  });

  it("stops reading once every candidate is named", async () => {
    const w = world([LIVE]);
    await liveBuilds(w, 60, () => [LIVE]);
    w.objects.set(`content/${LIVE}`, Buffer.from("y"));
    const reads = slowReads(w);

    expect(await collectUnreferencedContent(w.deps)).toBe(0);

    // Only the reads already running when the first one answered; none of the other builds.
    expect(reads.started).toBeLessThanOrEqual(EIGHT);
    expect(w.objects.has(`content/${LIVE}`)).toBe(true);
  });

  it("deletes nothing and gives every claim back when a manifest cannot be read, even if another names a candidate", async () => {
    const w = world([GOOD, LIVE]);
    await liveBuilds(w, 12, (index) => (index === 3 ? [LIVE] : []));
    w.objects.set(`content/${GOOD}`, Buffer.from("x"));
    w.objects.set(`content/${LIVE}`, Buffer.from("y"));
    const real = w.deps.storage.read.bind(w.deps.storage);
    vi.spyOn(w.deps.storage, "read").mockImplementation(async (key: string) => {
      if (key.includes("b007")) throw new Error("storage unavailable");
      return await real(key);
    });

    expect(await collectUnreferencedContent(w.deps)).toBe(0);

    expect(w.deleteSpy).not.toHaveBeenCalled();
    expect(w.objects.has(`content/${GOOD}`)).toBe(true);
    expect(w.objects.has(`content/${LIVE}`)).toBe(true);
    expect(w.lifecycle.finishContentCollection).not.toHaveBeenCalled();
    expect(w.lifecycle.abandonContentClaim).toHaveBeenCalledTimes(2);
    const logged = w.warn.mock.calls.filter(([, message]) =>
      String(message).startsWith("content collection skipped: a build manifest"),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toMatchObject({ builds: 12 });
  });

  it("collects again on the next pass once the manifests can be read", async () => {
    const w = world([GOOD]);
    await liveBuilds(w, 5, () => []);
    w.objects.set(`content/${GOOD}`, Buffer.from("x"));
    const read = vi.spyOn(w.deps.storage, "read").mockRejectedValueOnce(new Error("blip"));

    expect(await collectUnreferencedContent(w.deps)).toBe(0);
    expect(w.objects.has(`content/${GOOD}`)).toBe(true);
    read.mockRestore();
    expect(await collectUnreferencedContent(w.deps)).toBe(1);
    expect(w.objects.has(`content/${GOOD}`)).toBe(false);
  });
});
