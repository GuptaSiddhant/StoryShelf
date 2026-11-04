/** Shared lifecycle conformance tests. Each fixture must use independent connections. */
import { describe, expect, it } from "vitest";
import type {
  BuildReferenceLifecycle,
  BuildReferenceOwner,
  TxStore,
} from "../adapters/database.ts";

export interface BuildReferenceContractFixture {
  first: BuildReferenceLifecycle;
  second: BuildReferenceLifecycle;
  owner: BuildReferenceOwner;
  buildIds: readonly [string, string];
  /**
   * A domain write the suite makes inside a mutation, and a way to count the ones that committed
   * (read through a connection other than the transaction), so a rollback is observable.
   */
  marker: { write(tx: TxStore): Promise<void>; count(): Promise<number> };
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
    it("rejects a stale multi-owner update as a whole, domain writes included", async () => {
      await withFixture(async ({ first, second, owner, buildIds, marker }) => {
        const other = { ...owner, id: `${owner.id}-other` };
        await first.replaceManyFencedReferences(
          [
            { owner, expectedGeneration: 0, buildIds: [buildIds[0]] },
            { owner: other, expectedGeneration: 0, buildIds: [buildIds[1]] },
          ],
          marker.write,
        );
        expect(await marker.count()).toBe(1);
        await expect(
          second.replaceManyFencedReferences(
            [
              { owner, expectedGeneration: 1, buildIds: [] },
              { owner: other, expectedGeneration: 0, buildIds: [] },
            ],
            marker.write,
          ),
        ).rejects.toThrow();
        expect(await marker.count()).toBe(1);
        expect(await second.referenceGeneration(owner)).toBe(1);
        expect(await second.referenceGeneration(other)).toBe(1);
        expect(await first.claimDeletion(owner.projectId, buildIds[0])).toBe("protected");
        expect(await first.claimDeletion(owner.projectId, buildIds[1])).toBe("protected");
      });
    });
    it("keeps the generation across a release, so an old worker cannot release a newer pin", async () => {
      await withFixture(async ({ first, second, owner, buildIds }) => {
        await first.replaceFencedReferences(owner, 0, [buildIds[0]], async () => null);
        await first.replaceFencedReferences(owner, 1, [], async () => null);
        expect(await second.referenceGeneration(owner)).toBe(2);
        await second.replaceFencedReferences(owner, 2, [buildIds[1]], async () => null);
        // A worker that last saw generation 2 tries to release; the owner is at 3 now.
        await expect(
          first.replaceFencedReferences(owner, 2, [], async () => null),
        ).rejects.toThrow();
        expect(await second.referenceGeneration(owner)).toBe(3);
        expect(await first.claimDeletion(owner.projectId, buildIds[1])).toBe("protected");
      });
    });
    it("rejects admission to a deleting or a missing build, and changes nothing", async () => {
      await withFixture(async ({ first, second, owner, buildIds, marker }) => {
        expect(await second.claimDeletion(owner.projectId, buildIds[0])).toBe("claimed");
        await expect(
          first.replaceFencedReferences(owner, 0, [buildIds[0]], marker.write),
        ).rejects.toThrow();
        await expect(
          first.replaceFencedReferences(owner, 0, ["no-such-build"], marker.write),
        ).rejects.toThrow();
        await expect(
          first.replaceFencedReferences(owner, 0, [buildIds[1], buildIds[0]], marker.write),
        ).rejects.toThrow();
        expect(await marker.count()).toBe(0);
        expect(await first.referenceGeneration(owner)).toBe(0);
        expect(await first.claimDeletion(owner.projectId, buildIds[1])).toBe("claimed");
      });
    });
    it("ends an admission racing a claim in exactly one outcome", async () => {
      await withFixture(async ({ first, second, owner, buildIds, marker }) => {
        const [admission, claim] = await Promise.allSettled([
          first.replaceFencedReferences(owner, 0, [buildIds[0]], marker.write),
          second.claimDeletion(owner.projectId, buildIds[0]),
        ]);
        if (claim.status !== "fulfilled") throw new Error("claim failed");
        if (admission.status === "fulfilled") {
          expect(claim.value).toBe("protected");
          expect(await marker.count()).toBe(1);
          expect(await first.referenceGeneration(owner)).toBe(1);
        } else {
          expect(claim.value).toBe("claimed");
          expect(await marker.count()).toBe(0);
          expect(await first.referenceGeneration(owner)).toBe(0);
        }
      });
    });
    it("admits two owners that touch the same builds in opposite order without deadlock", async () => {
      await withFixture(async ({ first, second, owner, buildIds }) => {
        const other = { ...owner, id: `${owner.id}-other` };
        const settled = await Promise.all([
          first.replaceFencedReferences(owner, 0, [buildIds[0], buildIds[1]], async () => null),
          second.replaceFencedReferences(other, 0, [buildIds[1], buildIds[0]], async () => null),
        ]);
        expect(settled.map((result) => result.generation)).toEqual([1, 1]);
        expect(await first.claimDeletion(owner.projectId, buildIds[0])).toBe("protected");
        expect(await second.claimDeletion(owner.projectId, buildIds[1])).toBe("protected");
      });
    });
    it("lists a claimed build with its recorded steps and lets a second connection resume it", async () => {
      await withFixture(async ({ first, second, owner, buildIds }) => {
        expect(await first.listDeleting(owner.projectId)).toEqual([]);
        expect(await first.claimDeletion(owner.projectId, buildIds[0])).toBe("claimed");
        const base = { projectId: owner.projectId, buildId: buildIds[0] };
        expect(await second.listDeleting(owner.projectId)).toEqual([
          { ...base, contentReleased: false, storageDeleted: false },
        ]);
        expect(await first.releaseBuildContent(owner.projectId, buildIds[0], [])).toBe("done");
        expect(await second.listDeleting(owner.projectId)).toEqual([
          { ...base, contentReleased: true, storageDeleted: false },
        ]);
      });
    });
    it("takes the cleanup steps in order, each once, and completes the rows step in one transaction", async () => {
      await withFixture(async ({ first, second, owner, buildIds, marker }) => {
        const project = owner.projectId;
        expect(await first.releaseBuildContent(project, buildIds[0], [])).toBe("not-deleting");
        await first.claimDeletion(project, buildIds[0]);
        expect(await first.markStorageDeleted(project, buildIds[0])).toBe("out-of-order");
        expect(await first.completeDeletion(project, buildIds[0], marker.write)).toBe(
          "out-of-order",
        );
        expect(await marker.count()).toBe(0);

        expect(await first.releaseBuildContent(project, buildIds[0], [])).toBe("done");
        expect(await second.releaseBuildContent(project, buildIds[0], [])).toBe("already-done");
        expect(await first.markStorageDeleted(project, buildIds[0])).toBe("done");
        expect(await second.markStorageDeleted(project, buildIds[0])).toBe("already-done");

        expect(await first.completeDeletion(project, buildIds[0], marker.write)).toEqual({
          result: undefined,
        });
        expect(await marker.count()).toBe(1);
        // A write that leaves the build in place keeps its recorded steps for the next run.
        expect(await second.listDeleting(project)).toEqual([
          { projectId: project, buildId: buildIds[0], contentReleased: true, storageDeleted: true },
        ]);
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
