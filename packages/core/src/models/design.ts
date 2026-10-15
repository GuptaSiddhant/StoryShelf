/** Design-source links: project-level design files and per-component (story file) mappings. */
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { InvalidDesignUrlError, parseDesignUrl, type DesignProvider } from "../adapters/design.ts";
import type { DesignLink } from "../schema/design.ts";
import { ulid } from "../utils/ulid.ts";
import { normalizeImportPath } from "./design-resolve.ts";

/** Tables required by {@link DesignModel}. */
export interface DesignTables {
  designLinks: Table;
}

/** Data operations for design links; URLs are validated by the configured providers. */
export class DesignModel {
  private readonly tables: DesignTables;
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly providers: readonly DesignProvider[],
    tables?: DesignTables,
  ) {
    this.tables = tables ?? { designLinks: db.tables.designLinks };
  }

  /** Project-level design file links, oldest first. */
  async projectLinks(projectId: string): Promise<DesignLink[]> {
    return (await this.links(projectId)).filter((link) => link.importPath === null);
  }

  /** Component mapping overrides (`import_path → URL`), by path. */
  async componentLinks(projectId: string): Promise<DesignLink[]> {
    return (await this.links(projectId))
      .filter((link) => link.importPath !== null)
      .toSorted((a, b) => (a.importPath ?? "").localeCompare(b.importPath ?? ""));
  }

  /** Add a project-level design file link. Throws {@link InvalidDesignUrlError}. */
  async addProjectLink(projectId: string, input: { label: string; url: string }): Promise<void> {
    const url = this.validUrl(input.url);
    await this.insertLink(projectId, { importPath: null, label: input.label.trim() || null, url });
  }

  /** Map a story file to a design URL (replaces any existing mapping). Throws {@link InvalidDesignUrlError}. */
  async setComponentLink(projectId: string, importPath: string, rawUrl: string): Promise<void> {
    const url = this.validUrl(rawUrl);
    const key = normalizeImportPath(importPath);
    if (await this.updateComponentLink(projectId, key, url)) return;
    try {
      await this.insertLink(projectId, { importPath: key, label: null, url });
    } catch (error) {
      // A concurrent writer won the (project_id, import_path) unique index: converge on an update.
      if (!(await this.updateComponentLink(projectId, key, url))) throw error;
    }
  }

  /** Remove a link scoped to the project. */
  async removeLink(projectId: string, id: string): Promise<void> {
    const found = (await this.links(projectId)).find((link) => link.id === id);
    if (found) await this.db.remove(this.tables.designLinks, id);
  }

  private validUrl(raw: string): string {
    const parsed = parseDesignUrl(this.providers, raw);
    if (!parsed) {
      throw new InvalidDesignUrlError(
        raw,
        this.providers.map((p) => p.metadata.urlHint).join(" or "),
      );
    }
    return parsed.ref.url;
  }

  /** Update the mapping of `key` when one exists; false when there is none. */
  private async updateComponentLink(projectId: string, key: string, url: string): Promise<boolean> {
    const existing = (await this.componentLinks(projectId)).find(
      (link) => normalizeImportPath(link.importPath ?? "") === key,
    );
    if (!existing) return false;
    await this.db.update(this.tables.designLinks, existing.id, {
      url,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  private async links(projectId: string): Promise<DesignLink[]> {
    const column = getTableColumns(this.tables.designLinks)["projectId"] as unknown as SQLWrapper;
    const rows = (await this.db.list(this.tables.designLinks, {
      where: eq(column, projectId),
    })) as unknown as DesignLink[];
    return rows.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private async insertLink(
    projectId: string,
    input: { importPath: string | null; label: string | null; url: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db.insert(this.tables.designLinks, {
      id: ulid(),
      projectId,
      ...input,
      createdAt: now,
      updatedAt: now,
    });
  }
}
