import { describe, expect, it, vi } from "vitest";
import { duplicateGroupsSql, logSkippedIndex, parseUniqueIndex } from "./skipped-index.ts";

describe("parseUniqueIndex", () => {
  it("reads the index, table and columns of a CREATE UNIQUE INDEX, with or without IF NOT EXISTS", () => {
    expect(
      parseUniqueIndex(
        "CREATE UNIQUE INDEX IF NOT EXISTS design_links_project_import_path_idx ON design_links (project_id, import_path)",
      ),
    ).toEqual({
      index: "design_links_project_import_path_idx",
      table: "design_links",
      columns: "project_id, import_path",
    });
    expect(parseUniqueIndex("CREATE UNIQUE INDEX i ON t(a)")).toEqual({
      index: "i",
      table: "t",
      columns: "a",
    });
  });

  it("is null for any other statement", () => {
    expect(parseUniqueIndex("CREATE INDEX i ON t (a)")).toBeNull();
    expect(parseUniqueIndex("DROP INDEX i")).toBeNull();
  });
});

describe("duplicateGroupsSql", () => {
  it("counts the keys that repeat", () => {
    expect(duplicateGroupsSql("design_links", "project_id, import_path")).toBe(
      "SELECT COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM design_links GROUP BY project_id, import_path HAVING COUNT(*) > 1) AS repeated",
    );
  });
});

describe("logSkippedIndex", () => {
  it("logs once at error with the table, index and group count, and how to fix it, never a row", () => {
    const error = vi.fn();
    logSkippedIndex({ error } as never, {
      table: "design_links",
      index: "design_links_project_import_path_idx",
      columns: "project_id, import_path",
      duplicateGroups: 3,
    });

    expect(error).toHaveBeenCalledOnce();
    const [fields, message] = error.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toEqual({
      table: "design_links",
      index: "design_links_project_import_path_idx",
      duplicateGroups: 3,
    });
    expect(message).toContain("design_links_project_import_path_idx");
    expect(message).toContain("3 key(s)");
    expect(message).toContain("GROUP BY project_id, import_path HAVING COUNT(*) > 1");
    expect(message).toContain("created on the next boot");
  });

  it("says nothing without a logger", () => {
    expect(() =>
      logSkippedIndex(undefined, { table: "t", index: "i", columns: "a", duplicateGroups: 1 }),
    ).not.toThrow();
  });
});
