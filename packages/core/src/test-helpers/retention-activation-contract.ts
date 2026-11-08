/**
 * Shared conformance tests for a dialect's retention activation (ADR 0039): the boot step that
 * prepares the baseline pins before an adapter exposes `buildReferenceLifecycle`. Activation stays
 * each adapter's own step; only these tests are shared, so "never guess a baseline's source build"
 * and the pause cases behave the same in every dialect. Each harness works on its own fresh
 * database holding project `p` and two available builds, `one` and `two`.
 */
import { describe, expect, it } from "vitest";
import type { BuildReferenceLifecycle, RetentionPause } from "../adapters/database.ts";

/** A baseline row the suite seeds; the harness fills the other columns with valid defaults. */
export interface SeededBaseline {
  id: string;
  /** Defaults to the id, so two seeded baselines never share a baseline key. */
  storyId?: string;
  sourceBuildId?: string | null;
  snapshotId?: string | null;
}

/** A snapshot row the suite seeds (project `p`). */
export interface SeededSnapshot {
  id: string;
  buildId: string;
  storyId: string;
  inherited: boolean;
  sourceBuildId: string | null;
}

export interface RetentionActivationHarness {
  /** A lifecycle on its own connection to the same database the activation prepares. */
  lifecycle: BuildReferenceLifecycle;
  /**
   * The adapter's own boot step: prepare the baselines, as activation does before it exposes the
   * capability. Resolves to why retention stays off (the pause), or `undefined` once prepared.
   */
  prepare(): Promise<RetentionPause | undefined>;
  seed: {
    baseline(row: SeededBaseline): Promise<void>;
    snapshot(row: SeededSnapshot): Promise<void>;
    /** A build `id` of a project other than `p`. */
    foreignBuild(id: string): Promise<void>;
  };
  /** The baseline's recorded `sourceBuildId`, or `null` when it has none. */
  baselineSource(id: string): Promise<string | null>;
}
export type RetentionActivationHarnessRunner = (
  run: (harness: RetentionActivationHarness) => Promise<void>,
) => Promise<void>;

/** A domain write that does nothing. */
const none = async (): Promise<null> => await Promise.resolve(null);

const baselineOwner = (id: string) => ({ projectId: "p", type: "baseline", id }) as const;

/** Exercise baseline preparation through the lifecycle's observable state: pins and generations. */
export function retentionActivationContractSuite(
  label: string,
  withHarness: RetentionActivationHarnessRunner,
): void {
  describe(`retention activation contract: ${label}`, () => {
    it("pins a known source, keeps a recorded source whose build is gone, and repeats as a no-op", async () => {
      await withHarness(async ({ lifecycle, prepare, seed, baselineSource }) => {
        await seed.baseline({ id: "known", sourceBuildId: "one" });
        await seed.baseline({ id: "gone", sourceBuildId: "missing" });

        expect(await prepare()).toBeUndefined();
        expect(await prepare()).toBeUndefined();

        // The verified historical record stays: no pin, no generation change.
        expect(await baselineSource("gone")).toBe("missing");
        expect(await lifecycle.referenceGeneration(baselineOwner("gone"))).toBe(0);
        expect(await lifecycle.referenceGeneration(baselineOwner("known"))).toBe(1);
        expect(await lifecycle.claimDeletion("p", "two")).toBe("claimed");
        expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
      });
    });
    it("releases a stale pin of a baseline whose recorded source is gone, and keeps the record", async () => {
      await withHarness(async ({ lifecycle, prepare, seed, baselineSource }) => {
        await seed.baseline({ id: "gone", sourceBuildId: "missing" });
        // A pin on a build that is not the record's source cannot be justified.
        await lifecycle.replaceFencedReferences(
          baselineOwner("gone"),
          0,
          ["two"],
          async () => null,
        );
        expect(await lifecycle.referenceGeneration(baselineOwner("gone"))).toBe(1);

        expect(await prepare()).toBeUndefined();
        expect(await prepare()).toBeUndefined();

        expect(await baselineSource("gone")).toBe("missing");
        // Advanced once, by the removal; the classification and the repeat do not advance it.
        expect(await lifecycle.referenceGeneration(baselineOwner("gone"))).toBe(2);
        expect(await lifecycle.claimDeletion("p", "two")).toBe("claimed");
      });
    });
    it("releases the pins of a baseline that lost its provenance or was deleted while retention was off", async () => {
      await withHarness(async ({ lifecycle, prepare, seed }) => {
        await seed.baseline({ id: "cleared", snapshotId: null });
        await seed.baseline({ id: "kept", sourceBuildId: "two" });
        await lifecycle.replaceFencedReferences(baselineOwner("cleared"), 0, ["one"], none);
        await lifecycle.replaceFencedReferences(baselineOwner("deleted"), 0, ["one"], none);
        await lifecycle.replaceFencedReferences(baselineOwner("kept"), 0, ["two"], none);

        expect(await prepare()).toBeUndefined();

        // Only the baseline with a proven source still pins; the others' pins on `one` are gone.
        expect(await lifecycle.referenceGeneration(baselineOwner("deleted"))).toBe(2);
        expect(await lifecycle.claimDeletion("p", "two")).toBe("protected");
        expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
      });
    });
    it("leaves a baseline of unproven provenance unknown and unpinned", async () => {
      await withHarness(async ({ lifecycle, prepare, seed, baselineSource }) => {
        // A snapshot that no longer exists proves nothing, and there is no recorded source.
        await seed.baseline({ id: "orphan", snapshotId: "snap" });

        expect(await prepare()).toBeUndefined();
        expect(await prepare()).toBeUndefined();

        expect(await baselineSource("orphan")).toBeNull();
        expect(await lifecycle.referenceGeneration(baselineOwner("orphan"))).toBe(0);
        expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
        expect(await lifecycle.claimDeletion("p", "two")).toBe("claimed");
      });
    });
    it("recovers the renderer source of an inherited baseline without pinning its containing build", async () => {
      await withHarness(async ({ lifecycle, prepare, seed, baselineSource }) => {
        await seed.snapshot({
          id: "inherited",
          buildId: "two",
          storyId: "story",
          inherited: true,
          sourceBuildId: "one",
        });
        await seed.baseline({
          id: "base",
          storyId: "story",
          snapshotId: "inherited",
          sourceBuildId: null,
        });

        expect(await prepare()).toBeUndefined();

        expect(await baselineSource("base")).toBe("one");
        expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
        expect(await lifecycle.claimDeletion("p", "two")).toBe("claimed");
      });
    });
    it("releases a stale baseline pin when preparation resolves a different source", async () => {
      await withHarness(async ({ lifecycle, prepare, seed }) => {
        await seed.baseline({ id: "base", snapshotId: "snap", sourceBuildId: "one" });
        await lifecycle.replaceFencedReferences(
          baselineOwner("base"),
          0,
          ["two"],
          async () => null,
        );

        expect(await prepare()).toBeUndefined();

        expect(await lifecycle.referenceGeneration(baselineOwner("base"))).toBe(2);
        expect(await lifecycle.claimDeletion("p", "two")).toBe("claimed");
        expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
      });
    });
    it("pauses and rolls everything back when a recorded source is tombstoned", async () => {
      await withHarness(async ({ lifecycle, prepare, seed, baselineSource }) => {
        // Preparation runs in id order: "a-healthy" is pinned first, then "z-doomed" stops the run;
        // the pin must not survive the rollback.
        await seed.baseline({ id: "a-healthy", sourceBuildId: "one" });
        await seed.baseline({ id: "z-doomed", sourceBuildId: "two" });
        expect(await lifecycle.claimDeletion("p", "two")).toBe("claimed");

        expect(await prepare()).toEqual({
          baselineId: "z-doomed",
          buildId: "two",
          problem: "tombstoned",
        });

        expect(await lifecycle.referenceGeneration(baselineOwner("a-healthy"))).toBe(0);
        expect(await baselineSource("z-doomed")).toBe("two");
        // The tombstone is untouched and the healthy source was not left pinned.
        expect(await lifecycle.claimDeletion("p", "two")).toBe("deleting");
        expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
      });
    });
    it("pauses and rolls everything back when a recorded source belongs to another project", async () => {
      await withHarness(async ({ lifecycle, prepare, seed, baselineSource }) => {
        await seed.foreignBuild("foreign");
        await seed.baseline({ id: "a-healthy", sourceBuildId: "one" });
        await seed.baseline({ id: "z-crossed", sourceBuildId: "foreign" });

        expect(await prepare()).toEqual({
          baselineId: "z-crossed",
          buildId: "foreign",
          problem: "other-project",
        });

        expect(await baselineSource("z-crossed")).toBe("foreign");
        expect(await lifecycle.referenceGeneration(baselineOwner("a-healthy"))).toBe(0);
        expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
      });
    });
  });
}
