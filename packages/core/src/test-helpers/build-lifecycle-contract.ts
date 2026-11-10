/**
 * Shared build-lifecycle conformance tests (ADR 0046): every `from × to` pair of build statuses
 * through `BuildModel`, and the fence on a status derived from verdicts. Each case runs against the
 * adapter's own SQL, so SQLite, PGlite, real Postgres and MySQL all prove the compare-and-set.
 */
import { describe, expect, it } from "vite-plus/test";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { BUILD_STATUSES, canMove, exitFrom } from "../lifecycle/build-lifecycle.ts";
import { createShelfLogger } from "../logger.ts";
import { BuildReviewModel } from "../models/build-review.ts";
import { BuildModel } from "../models/build.ts";
import type { BuildStatus } from "../types.ts";
import { createTestBuild, createTestProject } from "./create-project.ts";

/** The pair test runs 64 seeded writes; PGlite needs more than vitest's 5 s default for them. */
const PAIR_TEST_TIMEOUT_MS = 60_000;

/** Build the adapter under test (sync or async factories both work). */
export type BuildLifecycleDatabaseFactory = () => DatabaseAdapter | Promise<DatabaseAdapter>;

async function setUp(make: BuildLifecycleDatabaseFactory): Promise<{
  db: DatabaseAdapter;
  builds: BuildModel;
  reviews: BuildReviewModel;
  projectId: string;
}> {
  const db = await make();
  await db.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
  const project = await createTestProject(db, db.tables);
  return {
    db,
    builds: new BuildModel(db),
    reviews: new BuildReviewModel(db),
    projectId: project.id,
  };
}

/** Run the build lifecycle contract against a factory. */
export function buildLifecycleContractSuite(
  label: string,
  make: BuildLifecycleDatabaseFactory,
): void {
  describe(`build lifecycle contract: ${label}`, () => {
    it(
      "applies every allowed status move and refuses every other, leaving the row unchanged",
      async () => {
        const { db, builds, projectId } = await setUp(make);
        const pairs = BUILD_STATUSES.flatMap((from) =>
          BUILD_STATUSES.map((to) => [from, to] as const),
        );
        expect(pairs).toHaveLength(BUILD_STATUSES.length ** 2);
        for (const [from, to] of pairs) {
          // oxlint-disable-next-line no-await-in-loop -- each pair needs its own seeded row
          const build = await createTestBuild(db, db.tables, projectId);
          // The one place a status is seeded without the table: the row must start in `from`.
          // oxlint-disable-next-line no-await-in-loop
          await db.update(db.tables.builds, build.id, { status: from });
          // oxlint-disable-next-line no-await-in-loop
          const before = await builds.get(build.id);
          // oxlint-disable-next-line no-await-in-loop
          const returned = await builds.setStatus(build.id, to);
          // oxlint-disable-next-line no-await-in-loop
          const after = await builds.get(build.id);
          const expected: BuildStatus = canMove(from, to) ? to : from;
          expect(returned.status, `${from} → ${to}`).toBe(expected);
          expect(after?.status, `${from} → ${to}`).toBe(expected);
          if (!canMove(from, to)) {
            expect(after, `${from} → ${to} leaves the row unchanged`).toEqual(before);
          }
        }
      },
      PAIR_TEST_TIMEOUT_MS,
    );

    it(
      "lets a retry leave any status, through the one reset write",
      async () => {
        const { db, builds, projectId } = await setUp(make);
        for (const from of exitFrom("retry", "pending")) {
          // oxlint-disable-next-line no-await-in-loop
          const build = await createTestBuild(db, db.tables, projectId);
          // oxlint-disable-next-line no-await-in-loop
          await db.update(db.tables.builds, build.id, { status: from });
          // oxlint-disable-next-line no-await-in-loop
          const reset = await builds.resetStatus(build.id, "pending");
          expect(reset.status, `retry from ${from}`).toBe("pending");
        }
      },
      PAIR_TEST_TIMEOUT_MS,
    );

    it("refuses a status derived from verdicts once a newer verdict exists", async () => {
      const { db, builds, reviews, projectId } = await setUp(make);
      const build = await createTestBuild(db, db.tables, projectId);
      const approval = await reviews.add(build.id, null, "approved");
      // The approval is computed from `approval`; a rejection lands and decides before it is written.
      const rejection = await reviews.add(build.id, null, "rejected");
      const decided = await builds.setStatus(
        build.id,
        "rejected",
        reviews.newestVerdictIs(build.id, rejection.id),
      );
      expect(decided.status).toBe("rejected");

      const late = await builds.setStatus(
        build.id,
        "approved",
        reviews.newestVerdictIs(build.id, approval.id),
      );

      expect(late.status).toBe("rejected");
      expect((await builds.get(build.id))?.status).toBe("rejected");
    });

    it("fences on having no verdicts at all", async () => {
      const { db, builds, reviews, projectId } = await setUp(make);
      const build = await createTestBuild(db, db.tables, projectId);
      await reviews.add(build.id, null, "approved");

      const refused = await builds.setStatus(
        build.id,
        "approved",
        reviews.newestVerdictIs(build.id, null),
      );
      expect(refused.status).toBe("pending");

      const other = await createTestBuild(db, db.tables, projectId);
      const written = await builds.setStatus(
        other.id,
        "approved",
        reviews.newestVerdictIs(other.id, null),
      );
      expect(written.status).toBe("approved");
    });
  });
}
