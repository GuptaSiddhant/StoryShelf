/** Shared lifecycle conformance tests. Each fixture must use independent connections. */
import { describe, expect, it } from "vitest";
import type { BuildReferenceLifecycle, BuildReferenceOwner } from "../adapters/database.ts";

export interface BuildReferenceContractFixture {
  first: BuildReferenceLifecycle;
  second: BuildReferenceLifecycle;
  owner: BuildReferenceOwner;
  buildIds: readonly [string, string];
}
export type BuildReferenceContractFixtureRunner = (
  run: (fixture: BuildReferenceContractFixture) => Promise<void>,
) => Promise<void>;

/** Exercise atomic owner replacement and deletion using separate adapter connections. */
export function buildReferenceContractSuite(
  label: string,
  withFixture: BuildReferenceContractFixtureRunner,
): void {
  describe(`build reference lifecycle contract: ${label}`, () => {
    it("serializes replacement against deletion of the newly referenced build", async () => {
      await withFixture(async ({ first, second, owner, buildIds }) => {
        await first.replaceFencedReferences(owner, 0, [buildIds[0]], async () => null);
        const [replacement, deletion] = await Promise.allSettled([
          first.replaceFencedReferences(owner, 1, [buildIds[1]], async () => null),
          second.claimDeletion(owner.projectId, buildIds[1]),
        ]);
        expect(deletion.status).toBe("fulfilled");
        if (deletion.status !== "fulfilled") throw new Error("deletion failed");
        if (replacement.status === "fulfilled") {
          expect(deletion.value).toBe("protected");
          expect(await first.claimDeletion(owner.projectId, buildIds[0])).toBe("claimed");
        } else {
          expect(deletion.value).toBe("claimed");
          expect(await first.claimDeletion(owner.projectId, buildIds[0])).toBe("protected");
        }
      });
    });
    it("serializes an admission against deletion", async () => {
      await withFixture(async ({ first, second, owner, buildIds }) => {
        const [admission, deletion] = await Promise.allSettled([
          first.replaceFencedReferences(owner, 0, [buildIds[0]], async () => null),
          second.claimDeletion(owner.projectId, buildIds[0]),
        ]);
        expect(deletion.status).toBe("fulfilled");
        if (deletion.status !== "fulfilled") throw new Error("deletion failed");
        if (admission.status === "fulfilled") expect(deletion.value).toBe("protected");
        else expect(deletion.value).toBe("claimed");
      });
    });
    it("rolls back domain failure and rejects stale generation after release", async () => {
      await withFixture(async ({ first, second, owner, buildIds }) => {
        await expect(
          first.replaceFencedReferences(owner, 0, [buildIds[0]], async () => {
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");
        expect(await second.referenceGeneration(owner)).toBe(0);
        expect(
          (
            await second.replaceFencedReferences(
              owner,
              0,
              [buildIds[0], buildIds[0]],
              async () => null,
            )
          ).generation,
        ).toBe(1);
        expect(await first.claimDeletion(owner.projectId, buildIds[0])).toBe("protected");
        expect(
          (await first.replaceFencedReferences(owner, 1, [], async () => null)).generation,
        ).toBe(2);
        await expect(
          second.replaceFencedReferences(owner, 1, [buildIds[1]], async () => null),
        ).rejects.toThrow();
        expect(await second.referenceGeneration(owner)).toBe(2);
        expect(await first.claimDeletion(owner.projectId, buildIds[1])).toBe("claimed");
        expect(await second.claimDeletion(owner.projectId, buildIds[0])).toBe("claimed");
        await expect(
          first.replaceFencedReferences(owner, 2, [buildIds[0]], async () => null),
        ).rejects.toThrow();
      });
    });
    it("rejects a duplicate owner in a multi-owner update", async () => {
      await withFixture(async ({ first, owner, buildIds }) => {
        const change = { owner, expectedGeneration: 0, buildIds: [buildIds[0]] };
        await expect(
          first.replaceManyFencedReferences([change, change], async () => null),
        ).rejects.toThrow();
        expect(await first.referenceGeneration(owner)).toBe(0);
        expect(await first.claimDeletion(owner.projectId, buildIds[0])).toBe("claimed");
      });
    });
  });
}
