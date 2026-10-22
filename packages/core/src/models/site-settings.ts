/** Site-wide key-value settings (`site_settings`): what the app learns while running. */
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { SiteSetting } from "../schema/site-setting.ts";

/** Tables required by {@link SiteSettingsModel}. */
export interface SiteSettingsTables {
  siteSettings: Table;
}

/** Data operations for `site_settings`, keyed by setting name. */
export class SiteSettingsModel {
  readonly #db: DatabaseAdapter;
  readonly #table: Table;

  constructor(db: DatabaseAdapter, tables?: SiteSettingsTables) {
    this.#db = db;
    this.#table = (tables ?? { siteSettings: db.tables.siteSettings }).siteSettings;
  }

  /** The setting's value, or `null` when it was never written. */
  async get(key: string): Promise<string | null> {
    const row = (await this.#db.get(this.#table, key)) as SiteSetting | null;
    return row?.value ?? null;
  }

  /** Write the setting, replacing any value; `updatedBy` names the person behind it. */
  async set(key: string, value: string, updatedBy?: string): Promise<void> {
    const now = new Date().toISOString();
    const fields = { value, updatedBy: updatedBy ?? null, updatedAt: now };
    if ((await this.#db.get(this.#table, key)) !== null) {
      await this.#db.update(this.#table, key, fields);
      return;
    }
    try {
      await this.#db.insert(this.#table, { id: key, createdAt: now, ...fields });
    } catch (error) {
      // Another instance wrote the key first: this write still wins, as a later one.
      if ((await this.#db.get(this.#table, key)) === null) {
        throw error;
      }
      await this.#db.update(this.#table, key, fields);
    }
  }

  /** Delete the setting; a no-op when it is absent. */
  async remove(key: string): Promise<void> {
    await this.#db.remove(this.#table, key);
  }
}
