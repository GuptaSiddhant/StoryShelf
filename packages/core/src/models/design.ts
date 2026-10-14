/** Design-source links (project files + per-component overrides) and the project's Figma token. */
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { DesignLink, DesignToken } from "../schema/design.ts";
import { decryptCredential, encrypt, type SecretInput } from "../utils/encrypt.ts";
import { InvalidDesignUrlError, parseFigmaUrl } from "../utils/figma-url.ts";
import { ulid } from "../utils/ulid.ts";
import { normalizeImportPath, type DesignTokenStatus } from "./design-resolve.ts";

/** Tables required by {@link DesignModel}. */
export interface DesignTables {
  designLinks: Table;
  designTokens: Table;
}

/** Data operations for design links and the project's Figma token. */
export class DesignModel {
  private readonly tables: DesignTables;
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: DesignTables,
    private readonly secret?: SecretInput,
  ) {
    this.tables = tables ?? {
      designLinks: db.tables.designLinks,
      designTokens: db.tables.designTokens,
    };
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
    const url = validUrl(input.url);
    await this.insertLink(projectId, { importPath: null, label: input.label.trim() || null, url });
  }

  /** Map a story file to a design URL (replaces any existing mapping). Throws {@link InvalidDesignUrlError}. */
  async setComponentLink(projectId: string, importPath: string, rawUrl: string): Promise<void> {
    const url = validUrl(rawUrl);
    const key = normalizeImportPath(importPath);
    if (await this.updateComponentLink(projectId, key, url)) return;
    try {
      await this.insertLink(projectId, { importPath: key, label: null, url });
    } catch (error) {
      // A concurrent writer won the (project_id, import_path) unique index: converge on an update.
      if (!(await this.updateComponentLink(projectId, key, url))) throw error;
    }
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

  /** Remove a link scoped to the project. */
  async removeLink(projectId: string, id: string): Promise<void> {
    const found = (await this.links(projectId)).find((link) => link.id === id);
    if (found) await this.db.remove(this.tables.designLinks, id);
  }

  /** The project's token row (never the plaintext), or null. */
  async tokenInfo(projectId: string): Promise<DesignToken | null> {
    const rows = (await this.db.list(this.tables.designTokens, {
      where: eq(col(this.tables.designTokens, "projectId"), projectId),
      limit: 1,
    })) as unknown as DesignToken[];
    return rows[0] ?? null;
  }

  /** Decrypted token for API calls, or null when none is set. */
  async getToken(projectId: string): Promise<string | null> {
    const row = await this.tokenInfo(projectId);
    return row ? decryptCredential(this.secret, row.tokenEncrypted) : null;
  }

  /**
   * Store (or rotate) the project's Figma token. A new credential restarts the
   * 90-day clock (`createdAt`) and resets health to `unknown`.
   */
  async setToken(projectId: string, token: string): Promise<void> {
    const now = new Date().toISOString();
    const values = {
      tokenEncrypted: encrypt(this.secret, token),
      status: "unknown",
      checkedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    if (await this.replaceToken(projectId, values)) return;
    try {
      await this.db.insert(this.tables.designTokens, { id: ulid(), projectId, ...values });
    } catch (error) {
      // A concurrent writer inserted first (unique project_id): rotate theirs instead.
      if (!(await this.replaceToken(projectId, values))) throw error;
    }
  }

  private async replaceToken(
    projectId: string,
    values: Pick<
      DesignToken,
      "tokenEncrypted" | "status" | "checkedAt" | "createdAt" | "updatedAt"
    >,
  ): Promise<boolean> {
    const existing = await this.tokenInfo(projectId);
    if (!existing) return false;
    await this.db.update(this.tables.designTokens, existing.id, values);
    return true;
  }

  /** Delete the project's token. */
  async removeToken(projectId: string): Promise<void> {
    const existing = await this.tokenInfo(projectId);
    if (existing) await this.db.remove(this.tables.designTokens, existing.id);
  }

  /** Record the token's last observed API outcome; never moves the rotation age. */
  async recordTokenStatus(projectId: string, status: DesignTokenStatus): Promise<void> {
    const existing = await this.tokenInfo(projectId);
    if (!existing) return;
    await this.db.update(this.tables.designTokens, existing.id, {
      status,
      checkedAt: new Date().toISOString(),
    });
  }

  private async links(projectId: string): Promise<DesignLink[]> {
    const rows = (await this.db.list(this.tables.designLinks, {
      where: eq(col(this.tables.designLinks, "projectId"), projectId),
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

function validUrl(raw: string): string {
  const parsed = parseFigmaUrl(raw);
  if (!parsed) throw new InvalidDesignUrlError(raw);
  return parsed.url;
}

function col(table: Table, name: string): SQLWrapper {
  return getTableColumns(table)[name] as unknown as SQLWrapper;
}
