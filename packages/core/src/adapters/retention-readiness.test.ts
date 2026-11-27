import { describe, expect, it } from "vitest";
import {
  assertRetentionReady,
  RetentionNotReadyError,
  schemaServesRelease,
} from "./retention-readiness.ts";

describe("schemaServesRelease", () => {
  it.each([
    ["1.2.3", "1.2.0", true],
    ["1.2.3", "1.2.9-rc.1", true],
    ["1.2.3", "1.3.0", true],
    ["1.2.3", "1.1.9", false],
    ["1.2.3", "1.4.0", false],
    ["1.2.3", "2.2.3", false],
    ["1.2.3", null, false],
    ["1.2.3", "dev", false],
    ["0.0.0", "0.0.0", false],
    [undefined, "1.2.3", false],
  ])("release %s on a database recorded as %s: %s", (own, recorded, expected) => {
    expect(schemaServesRelease(own, recorded)).toBe(expected);
  });
});

describe("assertRetentionReady", () => {
  const store = (version: string | null) => ({ read: async () => version, write: async () => {} });

  it("passes when the level fits and no query finds a problem", async () => {
    await expect(
      assertRetentionReady({ release: "1.2.3", store: store("1.2.3"), query: async () => [] }),
    ).resolves.toBeUndefined();
  });

  it("reads the invalid source rows as arrays or as objects", async () => {
    for (const row of [
      ["base", "two", "tombstoned"],
      { id: "base", source_build_id: "two", problem: "tombstoned" },
    ]) {
      const query = async (sql: string) => (sql.includes("CASE WHEN") ? [row] : []);
      const error = await assertRetentionReady({
        release: "1.2.3",
        store: store("1.2.3"),
        query,
      }).catch((caught: unknown) => caught as Error);
      expect(error).toBeInstanceOf(RetentionNotReadyError);
      expect((error as Error).message).toMatch(
        /baseline base has an invalid source build two \(tombstoned\)/u,
      );
    }
  });

  it("refuses before running any query when the schema level does not fit", async () => {
    let queries = 0;
    await expect(
      assertRetentionReady({
        release: "1.2.3",
        store: store(null),
        query: async () => {
          queries += 1;
          return [];
        },
      }),
    ).rejects.toThrow(/not prepared/u);
    expect(queries).toBe(0);
  });
});
