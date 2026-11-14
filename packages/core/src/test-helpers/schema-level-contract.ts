import { describe, expect, it } from "vitest";
/**
 * Shared contract for the boot comparison of ADR 0053 (decision 2). Every database package runs it
 * against a real database: the sentinel table proves a skip ran no migration (the `site_settings`
 * table is dropped between opens and must only come back when migrations run).
 */
import { SchemaTooNewError } from "../adapters/schema-level.ts";

export interface SchemaLevelHarness {
  /** Open the database as release `release`, run `setup`, close the connection; the data stays. */
  open: (release: string | null) => Promise<void>;
  /** Drop a table a migration would recreate. */
  dropSentinel: () => Promise<void>;
  /** Whether the sentinel table exists. */
  hasSentinel: () => Promise<boolean>;
  /** The `schema_meta.version`, or `null` when the table or row is missing. */
  recorded: () => Promise<string | null>;
  /** Remove the `schema_meta` table, as in a database from before this ADR. */
  dropMeta: () => Promise<void>;
}

/** Register the contract; `harness` returns a fresh, empty database each call. */
export function describeSchemaLevelContract(
  name: string,
  harness: () => Promise<SchemaLevelHarness>,
): void {
  describe(`${name}: schema_meta boot comparison`, () => {
    it("migrates a new database and records the release", async () => {
      const h = await harness();
      await h.open("0.12.3");
      expect(await h.recorded()).toBe("0.12.3");
    });

    it("migrates again for the same minor or an older database, then records the release", async () => {
      const h = await harness();
      await h.open("0.12.0");
      await h.dropSentinel();
      await h.open("0.12.4");
      expect(await h.hasSentinel()).toBe(true);
      expect(await h.recorded()).toBe("0.12.4");
      await h.open("0.13.0");
      expect(await h.recorded()).toBe("0.13.0");
    });

    it("skips migrations when the database is one minor newer, and leaves the record", async () => {
      const h = await harness();
      await h.open("0.12.2");
      await h.dropSentinel();
      await h.open("0.11.9");
      expect(await h.hasSentinel()).toBe(false);
      expect(await h.recorded()).toBe("0.12.2");
    });

    it("refuses to start when the database is more than one minor newer", async () => {
      const h = await harness();
      await h.open("0.13.0");
      await h.dropSentinel();
      await expect(h.open("0.11.0")).rejects.toThrow(SchemaTooNewError);
      await expect(h.open("0.11.0")).rejects.toThrow(/0\.11\.0.*0\.13\.0/u);
      expect(await h.hasSentinel()).toBe(false);
      expect(await h.recorded()).toBe("0.13.0");
    });

    it("treats a database without schema_meta as older", async () => {
      const h = await harness();
      await h.open("0.12.0");
      await h.dropMeta();
      expect(await h.recorded()).toBeNull();
      await h.open("0.11.0");
      expect(await h.recorded()).toBe("0.11.0");
    });

    it("migrates without recording when the release is unknown", async () => {
      const h = await harness();
      await h.open(null);
      expect(await h.recorded()).toBeNull();
      await h.open("0.0.0");
      expect(await h.recorded()).toBeNull();
    });
  });
}
