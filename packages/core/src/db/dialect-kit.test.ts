import { integer, sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { id, int, text } from "./columns.ts";
import { defineTable } from "./define-table.ts";
import {
  applyFlags,
  buildAll,
  foreignKeysOf,
  referencedColumn,
  resolverOf,
  type ModifiableBuilder,
} from "./dialect-kit.ts";

const parents = sqliteTable("parents", { id: sqliteText("id").primaryKey() });

function recorder(): ModifiableBuilder & { calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) => (value?: unknown) => {
    calls.push(value === undefined ? name : `${name}:${JSON.stringify(value)}`);
  };
  return {
    calls,
    notNull: record("notNull"),
    primaryKey: record("primaryKey"),
    unique: record("unique"),
    default: record("default"),
  };
}

describe("dialect kit", () => {
  it("applies only the flags a column sets", () => {
    const plain = recorder();
    applyFlags(plain, text("a").spec, "u");
    expect(plain.calls).toEqual([]);
    const full = recorder();
    applyFlags(full, int("n").notNull().unique().default(0).spec, "t_n_key");
    expect(full.calls).toEqual(["notNull", 'unique:"t_n_key"', "default:0"]);
    const pk = recorder();
    applyFlags(pk, id("id").primaryKey().spec, "u");
    expect(pk.calls).toEqual(["primaryKey"]);
  });

  it("finds foreign keys and the columns they reference", () => {
    const child = defineTable("children", {
      id: id("id").primaryKey(),
      parentId: id("parent_id").references("parents", "id", "restrict"),
    });
    const [plan] = foreignKeysOf(child);
    expect(plan).toEqual({
      key: "parentId",
      column: "parent_id",
      reference: { table: "parents", column: "id", onDelete: "restrict" },
    });
    const resolve = resolverOf({ parents });
    expect(referencedColumn(resolve, plan!.reference)).toBe(parents.id);
    expect(() => referencedColumn(resolve, { ...plan!.reference, column: "nope" })).toThrow(
      "Unknown reference parents.nope",
    );
    expect(() => resolve("missing")).toThrow("Unknown table missing");
  });

  it("builds tables parents first, so later ones can reference earlier ones", () => {
    const one = defineTable("one", { id: id("id").primaryKey() });
    const two = defineTable("two", { oneId: id("one_id").references("one", "id", "cascade") });
    const seen: string[] = [];
    const made: Record<string, unknown> = {};
    const built = buildAll(
      [one, two],
      (table, resolve) => {
        seen.push(table.name);
        if (table.name === "two") {
          expect(resolve("one")).toBe(made.one);
          expect(resolve("parents")).toBe(parents);
        }
        made[table.name] = sqliteTable(table.name, { n: integer("n") });
        return made[table.name] as typeof parents;
      },
      { parents },
    );
    expect(seen).toEqual(["one", "two"]);
    expect(Object.keys(built)).toEqual(["one", "two"]);
  });
});
