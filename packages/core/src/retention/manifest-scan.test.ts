import { describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Logger } from "../logger.ts";
import { deferred, makeDatabase, makeStorage } from "../test-helpers/index.ts";
import { storybookDir } from "../utils/paths.ts";
import { MANIFEST_READ_CONCURRENCY, dropLiveHashes } from "./manifest-scan.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

// The limit was fixed at eight: a literal here, so changing the constant fails a test.
const EIGHT = 8;

function world() {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const warn = vi.fn();
  const deps = {
    db: db as DatabaseAdapter,
    storage,
    logger: { warn } as unknown as Logger,
  };
  return { deps, objects, warn };
}

/** `count` builds `b000`, `b001`, ...; `names(i)` is what build `i`'s manifest holds (raw JSON text allowed). */
async function builds(
  w: ReturnType<typeof world>,
  count: number,
  names: (index: number) => string[] | string,
  retentionState?: string,
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
      ...(retentionState ? { retentionState } : {}),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const held = names(index);
    w.objects.set(
      `${storybookDir("p1", id)}/manifest.json`,
      Buffer.from(
        typeof held === "string"
          ? held
          : JSON.stringify(Object.fromEntries(held.map((hash, at) => [`f${at}`, hash]))),
      ),
    );
  }
}

/** Hold every storage read at a gate, counting how many are waiting; `release` lets them all go. */
function gatedReads(w: ReturnType<typeof world>, until = EIGHT) {
  const real = w.deps.storage.read.bind(w.deps.storage);
  const gate = deferred();
  const reached = deferred();
  const stats = { started: 0, inFlight: 0, peak: 0 };
  vi.spyOn(w.deps.storage, "read").mockImplementation(async (key: string) => {
    stats.started += 1;
    stats.inFlight += 1;
    stats.peak = Math.max(stats.peak, stats.inFlight);
    if (stats.started >= until) reached.resolve();
    await gate.promise;
    stats.inFlight -= 1;
    return await real(key);
  });
  return { stats, reached: reached.promise, release: () => gate.resolve() };
}

describe("dropLiveHashes", () => {
  it("reads eight manifests at a time: eight wait together, and no ninth starts", async () => {
    const w = world();
    await builds(w, 40, () => [C]);
    const reads = gatedReads(w);
    const candidates = new Set([A]);

    const scan = dropLiveHashes(w.deps, candidates);
    await reads.reached;
    // Every lane is waiting at the gate; a lane cannot start another read before its first ends.
    expect(MANIFEST_READ_CONCURRENCY).toBe(EIGHT);
    expect(reads.stats).toMatchObject({ started: EIGHT, inFlight: EIGHT });
    reads.release();

    expect(await scan).toBe(true);
    // Nothing names A, so every manifest was read, never more than eight at once.
    expect(reads.stats.started).toBe(40);
    expect(reads.stats.peak).toBe(EIGHT);
    expect([...candidates]).toEqual([A]);
  });

  it("uses fewer lanes than eight for fewer builds", async () => {
    const w = world();
    await builds(w, 3, () => []);
    const reads = gatedReads(w, 3);
    const scan = dropLiveHashes(w.deps, new Set([A]));
    await reads.reached;
    reads.release();
    expect(await scan).toBe(true);
    expect(reads.stats.peak).toBe(3);
  });

  it("drops a candidate that only the last manifest names, and keeps the others", async () => {
    const w = world();
    await builds(w, 30, (index) => (index === 29 ? [B] : []));
    const reads = gatedReads(w);
    const candidates = new Set([A, B]);

    const scan = dropLiveHashes(w.deps, candidates);
    await reads.reached;
    reads.release();

    expect(await scan).toBe(true);
    expect([...candidates]).toEqual([A]);
  });

  it("stops reading once every candidate is named", async () => {
    const w = world();
    await builds(w, 60, () => [B]);
    const reads = gatedReads(w);
    const candidates = new Set([B]);

    const scan = dropLiveHashes(w.deps, candidates);
    await reads.reached;
    reads.release();

    expect(await scan).toBe(true);
    expect(candidates.size).toBe(0);
    // Only the eight reads already waiting; none of the other 52 builds was read.
    expect(reads.stats.started).toBe(EIGHT);
  });

  it("skips a build that is being deleted: its manifest does not save a candidate", async () => {
    const w = world();
    await builds(w, 2, () => [A], "deleting");
    const reads = gatedReads(w, 1);
    const candidates = new Set([A]);
    const scan = dropLiveHashes(w.deps, candidates);
    reads.release();
    expect(await scan).toBe(true);
    expect(reads.stats.started).toBe(0);
    expect([...candidates]).toEqual([A]);
  });

  it("answers false and logs once with counts when a manifest cannot be read", async () => {
    const w = world();
    await builds(w, 12, () => []);
    const real = w.deps.storage.read.bind(w.deps.storage);
    vi.spyOn(w.deps.storage, "read").mockImplementation(async (key: string) => {
      if (key.includes("b007")) throw new Error("storage unavailable");
      return await real(key);
    });

    expect(await dropLiveHashes(w.deps, new Set([A, B]))).toBe(false);

    const logged = w.warn.mock.calls.filter(([, message]) =>
      String(message).startsWith("content collection skipped: a build manifest"),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toMatchObject({ builds: 12 });
    expect(JSON.stringify(w.warn.mock.calls)).not.toContain("storage unavailable");
  });

  it.each(["{", "", "null", "[]", '"x"'])(
    "answers false for a live manifest that is not a JSON object: %j",
    async (body) => {
      const w = world();
      await builds(w, 10, (index) => (index === 6 ? body : []));
      expect(await dropLiveHashes(w.deps, new Set([A]))).toBe(false);
    },
  );

  it("answers true with nothing to read when there are no builds", async () => {
    const w = world();
    const candidates = new Set([A]);
    expect(await dropLiveHashes(w.deps, candidates)).toBe(true);
    expect([...candidates]).toEqual([A]);
  });
});
