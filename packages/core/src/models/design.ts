/** Design-source links (project files + per-component overrides), the Figma token, and file-level resolution. */
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { DesignLink, DesignToken } from "../schema/design.ts";
import { decryptCredential, encrypt, type SecretInput } from "../utils/encrypt.ts";
import { InvalidDesignUrlError, parseFigmaUrl } from "../utils/figma-url.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link DesignModel}. */
export interface DesignTables {
  designLinks: Table;
  designTokens: Table;
}

/** Last observed health of the project's Figma token. */
export type DesignTokenStatus = "unknown" | "ok" | "unauthorized" | "forbidden";

/** Where a component's resolved design link came from. */
export type DesignSource = "manual" | "story";

/** The design link(s) a story file resolves to. */
export interface DesignResolution {
  /** One URL, or the distinct set when states of the file disagree. */
  urls: string[];
  source: DesignSource;
}

/** Story-file key: path without a leading `./`, so index and manual entries compare equal. */
export function normalizeImportPath(path: string): string {
  return path.trim().replace(/^(?:\.\/)+/u, "");
}

/**
 * Resolve design links per component (story file). Precedence: manual mapping
 * > story parameters (`storyshelf.figma` over `design`, already merged at
 * capture). States of one file are deduped; if they disagree the distinct set
 * is returned rather than guessing. Files with no link are absent.
 */
export function resolveDesigns(
  manual: readonly Pick<DesignLink, "importPath" | "url">[],
  snapshots: readonly { storyImportPath: string | null; designUrl?: string | null }[],
): Map<string, DesignResolution> {
  const resolved = storyDesigns(snapshots);
  for (const link of manual) {
    if (link.importPath) {
      resolved.set(normalizeImportPath(link.importPath), { urls: [link.url], source: "manual" });
    }
  }
  return resolved;
}

/** Distinct story-declared URLs per file. */
function storyDesigns(
  snapshots: readonly { storyImportPath: string | null; designUrl?: string | null }[],
): Map<string, DesignResolution> {
  const resolved = new Map<string, DesignResolution>();
  for (const snapshot of snapshots) {
    const key = snapshot.storyImportPath ? normalizeImportPath(snapshot.storyImportPath) : "";
    if (!key || !snapshot.designUrl) continue;
    const urls = resolved.get(key)?.urls ?? [];
    if (!urls.includes(snapshot.designUrl)) urls.push(snapshot.designUrl);
    resolved.set(key, { urls, source: "story" });
  }
  return resolved;
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
    const existing = (await this.componentLinks(projectId)).find(
      (link) => normalizeImportPath(link.importPath ?? "") === key,
    );
    if (existing) {
      await this.db.update(this.tables.designLinks, existing.id, {
        url,
        updatedAt: new Date().toISOString(),
      });
    } else {
      await this.insertLink(projectId, { importPath: key, label: null, url });
    }
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

  /** Store (or rotate) the project's Figma token; health resets to `unknown`. */
  async setToken(projectId: string, token: string): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.tokenInfo(projectId);
    const values = {
      tokenEncrypted: encrypt(this.secret, token),
      status: "unknown",
      checkedAt: null,
    };
    if (existing) {
      await this.db.update(this.tables.designTokens, existing.id, { ...values, updatedAt: now });
      return;
    }
    await this.db.insert(this.tables.designTokens, {
      id: ulid(),
      projectId,
      ...values,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Delete the project's token. */
  async removeToken(projectId: string): Promise<void> {
    const existing = await this.tokenInfo(projectId);
    if (existing) await this.db.remove(this.tables.designTokens, existing.id);
  }

  /** Record the token's last observed API outcome. */
  async recordTokenStatus(projectId: string, status: DesignTokenStatus): Promise<void> {
    const existing = await this.tokenInfo(projectId);
    if (!existing) return;
    const now = new Date().toISOString();
    await this.db.update(this.tables.designTokens, existing.id, {
      status,
      checkedAt: now,
      updatedAt: now,
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
