import type { BuildComponent } from "@storyshelf/core/schema";
import { getTableColumns, getTableName } from "drizzle-orm";
import { expect, expectTypeOf, it } from "vitest";
import { DDL } from "../ddl.ts";
import { buildComponents } from "./build-component.ts";
import { schema } from "./index.ts";

it("types build_components rows exactly as core's BuildComponent", () => {
  expectTypeOf<BuildComponent>().toEqualTypeOf<typeof buildComponents.$inferSelect>();
  expect(schema.buildComponents).toBe(buildComponents);
  expect(getTableName(buildComponents)).toBe("build_components");
});

it("creates build_components and its indexes in the DDL, column for column", () => {
  const table = /CREATE TABLE IF NOT EXISTS build_components \((?<body>[^;]*)\);/u.exec(DDL)
    ?.groups?.["body"];
  expect(table).toBeDefined();
  for (const column of Object.values(getTableColumns(buildComponents))) {
    expect(table, column.name).toMatch(new RegExp(`^\\s*${column.name} `, "mu"));
  }
  for (const index of [
    "build_components_build_id_idx ON build_components (build_id)",
    "build_components_project_import_path_idx ON build_components (project_id, import_path)",
  ]) {
    expect(DDL).toContain(index);
  }
});
