import { describe, expect, it } from "vitest";
import { readSchemaRelease } from "./schema-release.ts";

describe("readSchemaRelease", () => {
  it("returns the recorded release", async () => {
    const db = { all: async () => await Promise.resolve([{ version: "0.14.0" }]) };
    expect(await readSchemaRelease(db as never)).toBe("0.14.0");
  });

  it("reads a row that is a value array (SQLite)", async () => {
    const db = { all: async () => await Promise.resolve([["0.13.2"]]) };
    expect(await readSchemaRelease(db as never)).toBe("0.13.2");
  });

  it("is null without a row, with a non-string version, or when the table is missing", async () => {
    expect(
      await readSchemaRelease({ all: async () => await Promise.resolve([]) } as never),
    ).toBeNull();
    expect(
      await readSchemaRelease({
        all: async () => await Promise.resolve([{ version: 3 }]),
      } as never),
    ).toBeNull();
    const missing = {
      all: async () => {
        await Promise.resolve();
        throw new Error("no such table: schema_meta");
      },
    };
    expect(await readSchemaRelease(missing as never)).toBeNull();
  });
});
