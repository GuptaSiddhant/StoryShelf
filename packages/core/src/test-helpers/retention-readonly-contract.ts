/**
 * Shared conformance tests for a dialect's read-only retention activation (ADR 0039): what a `tool`
 * command (`storyshelf-server purge`) may do on a database it did not migrate. The hook decides
 * from reads alone, so these cases pin down where it says yes (this release, or one minor newer),
 * where it refuses with one plain line (older release, never migrated, pins not prepared, a
 * paused baseline, a source run) and that it never writes. Each harness works on its own fresh,
 * empty database.
 */
import { describe, expect, it } from "vitest";
import { RetentionNotReadyError, type DatabaseAdapter } from "../adapters/database.ts";

export interface RetentionReadOnlyHarness {
  /** A fresh adapter on the shared database, set up the way `serve` or `migrate` does, as `release`. */
  boot(release: string): Promise<DatabaseAdapter>;
  /** A fresh adapter on the same database that is never set up, as a `tool` command's is. */
  open(): DatabaseAdapter;
}
export type RetentionReadOnlyHarnessRunner = (
  run: (harness: RetentionReadOnlyHarness) => Promise<void>,
) => Promise<void>;

const now = "2026-01-01T00:00:00.000Z";

/** Project `p`, builds `one` and `two`, and a baseline `base` whose recorded source is `two`. */
async function seed(db: DatabaseAdapter): Promise<void> {
  const { tables } = db;
  await db.insert(tables.projects, {
    id: "p",
    name: "P",
    slug: "p",
    createdAt: now,
    updatedAt: now,
  } as never);
  for (const id of ["one", "two"]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- two rows, in order
    await db.insert(tables.builds, {
      id,
      projectId: "p",
      gitSha: id,
      gitBranch: "main",
      status: "approved",
      createdAt: now,
      updatedAt: now,
    } as never);
  }
  await db.insert(tables.baselines, {
    id: "base",
    projectId: "p",
    storyId: "story",
    viewportName: "desktop",
    branch: "main",
    browser: "chromium",
    screenshotPath: "shot",
    snapshotId: "snap",
    sourceBuildId: "two",
    createdAt: now,
    updatedAt: now,
  } as never);
}

/** A database booted as `release` whose baseline pins are prepared (a second boot does that). */
async function prepared(harness: RetentionReadOnlyHarness, release: string): Promise<void> {
  await seed(await harness.boot(release));
  await harness.boot(release);
}

async function refusal(tool: DatabaseAdapter, release?: string): Promise<Error> {
  let error: Error | undefined;
  try {
    await tool.activateRetentionReadOnly?.({ release });
  } catch (caught) {
    error = caught as Error;
  }
  expect(error).toBeInstanceOf(RetentionNotReadyError);
  expect(tool.buildReferenceLifecycle).toBeUndefined();
  // One plain line that names the fix.
  expect(error?.message).not.toContain("\n");
  expect(error?.message).toContain("storyshelf-server serve");
  expect(error?.message).toContain("storyshelf-server migrate");
  return error as Error;
}

/** Exercise the read-only activation through the lifecycle it exposes and the rows it leaves alone. */
export function retentionReadOnlyContractSuite(
  label: string,
  withHarness: RetentionReadOnlyHarnessRunner,
): void {
  describe(`read-only retention activation contract: ${label}`, () => {
    it("exposes the fenced lifecycle on a database this release prepared, and writes nothing itself", async () => {
      await withHarness(async (harness) => {
        await prepared(harness, "1.2.3");
        const tool = harness.open();

        await tool.activateRetentionReadOnly?.({ release: "1.2.4" });

        expect(tool.buildReferenceLifecycle).toBeDefined();
        expect(tool.retentionPause).toBeUndefined();
        // The pin the server prepared holds, and the release record is the one `serve` wrote.
        expect(await tool.buildReferenceLifecycle?.claimDeletion("p", "two")).toBe("protected");
        expect(await tool.buildReferenceLifecycle?.claimDeletion("p", "one")).toBe("claimed");
        expect((await tool.get(tool.tables.schemaMeta, "schema")) as { version: string }).toEqual(
          expect.objectContaining({ version: "1.2.3" }),
        );
      });
    });

    it("accepts a database one minor newer, which boot skips its migrations for", async () => {
      await withHarness(async (harness) => {
        await prepared(harness, "1.3.0");
        const tool = harness.open();

        await tool.activateRetentionReadOnly?.({ release: "1.2.9" });

        expect(tool.buildReferenceLifecycle).toBeDefined();
      });
    });

    it("refuses a database an older release migrated", async () => {
      await withHarness(async (harness) => {
        await prepared(harness, "1.1.0");

        await refusal(harness.open(), "1.2.3");
      });
    });

    it("refuses a database further ahead than one minor", async () => {
      await withHarness(async (harness) => {
        await prepared(harness, "1.4.0");

        await refusal(harness.open(), "1.2.3");
      });
    });

    it("refuses a database that was never migrated, and leaves it that way", async () => {
      await withHarness(async (harness) => {
        const tool = harness.open();

        await refusal(tool, "1.2.3");

        await expect(tool.count(tool.tables.projects)).rejects.toThrow();
      });
    });

    it("refuses a source run, whose release has no schema level", async () => {
      await withHarness(async (harness) => {
        await prepared(harness, "1.2.3");

        await refusal(harness.open(), "0.0.0");
        await refusal(harness.open());
      });
    });

    it("refuses a recorded baseline source that no pin protects", async () => {
      await withHarness(async (harness) => {
        const server = await harness.boot("1.2.3");
        await seed(server); // no second boot: the baseline was never prepared

        const error = await refusal(harness.open(), "1.2.3");

        expect(error.message).toMatch(/not prepared/u);
      });
    });

    it("refuses while a baseline's recorded source build is being deleted", async () => {
      await withHarness(async (harness) => {
        const server = await harness.boot("1.2.3");
        await seed(server);
        expect(await server.buildReferenceLifecycle?.claimDeletion("p", "two")).toBe("claimed");

        const error = await refusal(harness.open(), "1.2.3");

        expect(error.message).toMatch(/paused: baseline base has an invalid source build two/u);
      });
    });
  });
}
