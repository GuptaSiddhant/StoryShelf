/** Budget-threshold alert claims: the primary key makes "once per day" atomic. */
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { AiBudgetAlertRow } from "../schema/insight.ts";

/** Tables required by {@link AiBudgetAlertModel}. */
export interface AiBudgetAlertTables {
  aiBudgetAlerts: Table;
}

/** Data operations for budget alert claims. */
export class AiBudgetAlertModel {
  private readonly tables: AiBudgetAlertTables;
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: AiBudgetAlertTables,
  ) {
    this.tables = tables ?? { aiBudgetAlerts: db.tables.aiBudgetAlerts };
  }

  /** Claim `(day, threshold)`; true only for the single instance that inserted it. */
  async claim(day: string, threshold: number): Promise<boolean> {
    try {
      await this.db.insert(this.tables.aiBudgetAlerts, {
        id: `${day}:${threshold}`,
        day,
        threshold,
        createdAt: new Date().toISOString(),
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Claims already made for a day. */
  async listForDay(day: string): Promise<AiBudgetAlertRow[]> {
    const col = getTableColumns(this.tables.aiBudgetAlerts)["day"] as unknown as SQLWrapper;
    return (await this.db.list(this.tables.aiBudgetAlerts, {
      where: eq(col, day),
    })) as unknown as AiBudgetAlertRow[];
  }
}
