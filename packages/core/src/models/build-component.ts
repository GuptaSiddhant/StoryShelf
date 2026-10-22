/** Component rows of published builds (`build_components`, ADR 0006 decision 9). */
import { and, asc, desc, eq } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { BuildComponent } from "../schema/build-component.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

/** Tables required by {@link BuildComponentModel}. */
export interface BuildComponentTables {
  buildComponents: Table;
}

/** What a build records of one component. */
export type BuildComponentInput = Pick<
  BuildComponent,
  "importPath" | "title" | "storyCount" | "hash"
>;

/** Data operations for the components each published build holds. */
export class BuildComponentModel {
  readonly #db: DatabaseAdapter;
  readonly #table: Table;

  constructor(db: DatabaseAdapter, tables?: BuildComponentTables) {
    this.#db = db;
    this.#table = (tables ?? { buildComponents: db.tables.buildComponents }).buildComponents;
  }

  /** Components of one build, ordered by title then file. */
  async listByBuild(buildId: string): Promise<BuildComponent[]> {
    const rows = (await this.#db.list(this.#table, {
      where: eq(col(this.#table, "buildId"), buildId),
      orderBy: asc(col(this.#table, "title")),
    })) as unknown as BuildComponent[];
    return rows.toSorted(
      (a, b) => a.title.localeCompare(b.title) || a.importPath.localeCompare(b.importPath),
    );
  }

  /** Rows of one story file across the project's builds, newest first: "which builds contain it". */
  async listByImportPath(projectId: string, importPath: string): Promise<BuildComponent[]> {
    const rows = (await this.#db.list(this.#table, {
      where: and(
        eq(col(this.#table, "projectId"), projectId),
        eq(col(this.#table, "importPath"), importPath),
      ),
      orderBy: desc(col(this.#table, "createdAt")),
    })) as unknown as BuildComponent[];
    return rows;
  }

  /** Replace a build's rows with `components`; repeating a publish never duplicates. */
  async replaceForBuild(
    projectId: string,
    buildId: string,
    components: readonly BuildComponentInput[],
  ): Promise<void> {
    await this.removeForBuild(buildId);
    const createdAt = new Date().toISOString();
    for (const component of components) {
      // eslint-disable-next-line no-await-in-loop -- rows are few; sequential inserts keep ids ordered
      await this.#db.insert(this.#table, {
        id: ulid(),
        projectId,
        buildId,
        createdAt,
        ...component,
      });
    }
  }

  /** Forget a build's rows (the foreign key cascades too; stub tables have none). */
  async removeForBuild(buildId: string): Promise<number> {
    const rows = (await this.#db.list(this.#table, {
      where: eq(col(this.#table, "buildId"), buildId),
    })) as unknown as BuildComponent[];
    await Promise.all(
      rows.map(async (row) => {
        await this.#db.remove(this.#table, row.id);
      }),
    );
    return rows.length;
  }
}
