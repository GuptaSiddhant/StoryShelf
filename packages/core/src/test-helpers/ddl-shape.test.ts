import { describe, expect, it } from "vitest";
import { ddlShape } from "./ddl-shape.ts";

const SQL = `
CREATE TABLE IF NOT EXISTS parents (id TEXT PRIMARY KEY);
CREATE TABLE \`kids\` (
  \`id\` varchar(64) NOT NULL,
  \`parent_id\` varchar(64) NOT NULL,
  CONSTRAINT \`kids_id\` PRIMARY KEY(\`id\`)
);
ALTER TABLE \`kids\` ADD CONSTRAINT \`fk_kids_parent_id\` FOREIGN KEY (\`parent_id\`) REFERENCES \`parents\`(\`id\`) ON DELETE cascade ON UPDATE no action;
CREATE INDEX kids_parent_idx ON kids USING btree (parent_id) WHERE parent_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS kids_pair_idx ON kids (id, parent_id);
DROP TABLE IF EXISTS old;
`;

describe("ddlShape", () => {
  it("collects tables, indexes and added foreign keys", () => {
    const shape = ddlShape(SQL, "mysql");
    expect([...shape.tables.keys()]).toEqual(["parents", "kids"]);
    const kids = shape.tables.get("kids");
    expect(kids?.foreignKeys).toEqual([
      {
        name: "fk_kids_parent_id",
        columns: ["parent_id"],
        detail: "parents(id) on delete cascade",
      },
    ]);
    expect(kids?.uniques).toEqual([
      { name: "kids_pair_idx", columns: ["id", "parent_id"], detail: "" },
    ]);
    expect(shape.indexes.get("kids_parent_idx")).toEqual({
      name: "kids_parent_idx",
      table: "kids",
      columns: ["parent_id"],
      where: "parent_id <> ''",
    });
  });

  it("ignores indexes and constraints of unknown tables", () => {
    const shape = ddlShape(
      "CREATE UNIQUE INDEX x ON nowhere (a); ALTER TABLE nowhere ADD CONSTRAINT f FOREIGN KEY (a) REFERENCES p(id)",
      "pg",
    );
    expect(shape.tables.size).toBe(0);
  });
});
