import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { CatalogLoader } from "@storyshelf/core/capture";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import {
  baselines,
  buildComponents,
  buildLabels,
  builds,
  catalogEntries,
  labelTypes,
  comments,
  otherProject,
  project,
  snapshots,
} from "./dataset.ts";

/**
 * Which data a page story renders over: `populated` is the "Design system" project with builds
 * in every state, `empty` has one project and no builds, `blank` has no projects at all.
 */
export type StoryDataset = "populated" | "empty" | "blank";

interface Seeded {
  db: DatabaseAdapter;
  catalog: CatalogLoader;
}

async function insertAll(
  db: DatabaseAdapter,
  table: Parameters<DatabaseAdapter["insert"]>[0],
  rows: readonly unknown[],
): Promise<void> {
  for (const row of rows) {
    // Rows are typed with the real schema interfaces in `dataset.ts`; the adapter's insert type is
    // the Drizzle table's, which those interfaces satisfy structurally.
    // oxlint-disable-next-line eslint/no-await-in-loop -- inserts are few and ordered
    await db.insert(table, row as never);
  }
}

const NO_CATALOG: CatalogLoader = {
  load: async () => await Promise.resolve(null),
  refresh: async () => await Promise.resolve(null),
};

/** The builds, snapshots, baselines, components and comments of the populated project. */
async function insertBuilds(db: DatabaseAdapter): Promise<void> {
  await insertAll(db, db.tables.builds, builds);
  await insertAll(db, db.tables.snapshots, snapshots);
  await insertAll(db, db.tables.baselines, baselines);
  await insertAll(db, db.tables.buildComponents, buildComponents);
  await insertAll(db, db.tables.comments, comments);
  await insertAll(db, db.tables.labelTypes, labelTypes);
  await insertAll(db, db.tables.buildLabels, buildLabels);
}

/** What every populated build publishes. */
const PUBLISHED: CatalogLoader = {
  load: async () => await Promise.resolve({ v: 1, entries: catalogEntries }),
  refresh: async () => await Promise.resolve({ v: 1, entries: catalogEntries }),
};

/** A fresh in-memory database holding the chosen dataset, and the catalog its builds publish. */
export async function seedStoryDatabase(dataset: StoryDataset): Promise<Seeded> {
  const { db } = makeDatabase();
  if (dataset === "blank") return { db, catalog: NO_CATALOG };
  await insertAll(db, db.tables.projects, [project, otherProject]);
  if (dataset === "empty") return { db, catalog: NO_CATALOG };
  await insertBuilds(db);
  return { db, catalog: PUBLISHED };
}
