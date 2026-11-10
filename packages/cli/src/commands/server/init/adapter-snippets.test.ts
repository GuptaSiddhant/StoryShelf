import { describe, expect, it } from "vite-plus/test";
import { DB_IMPORT, DB_INIT, dbPrelude, STORAGE_IMPORT, STORAGE_INIT } from "./adapter-snippets.ts";
import type { DatabaseChoice, StorageChoice } from "./answers.ts";

const DATABASES = Object.keys(DB_IMPORT) as DatabaseChoice[];
const STORAGES = Object.keys(STORAGE_IMPORT) as StorageChoice[];

/** The imported binding of `import { name } from "…";`. */
function importedName(line: string): string {
  return /^import \{ (?<name>\w+) \} from "/u.exec(line)?.groups?.["name"] ?? "";
}

describe("database snippets", () => {
  it("cover all 14 choices", () => {
    expect(DATABASES).toHaveLength(14);
    expect(Object.keys(DB_INIT).toSorted()).toEqual(DATABASES.toSorted());
  });

  it.each(DATABASES)("%s calls the function it imports", (database) => {
    const name = importedName(DB_IMPORT[database]);
    expect(name).toMatch(/^create\w+Database$/u);
    expect(DB_INIT[database].startsWith(`${name}(`)).toBe(true);
  });

  it("stubs the D1 binding, and only for D1", () => {
    expect(dbPrelude("d1").join("\n")).toContain("function getD1Binding(): never");
    expect(DB_INIT.d1).toContain("getD1Binding()");
    for (const database of DATABASES.filter((choice) => choice !== "d1")) {
      expect(dbPrelude(database)).toEqual([]);
    }
  });
});

describe("storage snippets", () => {
  it("cover all four choices", () => {
    expect(STORAGES.toSorted()).toEqual(["azure", "gcs", "local", "s3"]);
    expect(Object.keys(STORAGE_INIT).toSorted()).toEqual(STORAGES.toSorted());
  });

  it.each(STORAGES)("%s calls the function it imports", (storage) => {
    const name = importedName(STORAGE_IMPORT[storage]);
    expect(name).toMatch(/^create\w+Storage$/u);
    expect(STORAGE_INIT[storage].startsWith(`${name}(`)).toBe(true);
  });
});
