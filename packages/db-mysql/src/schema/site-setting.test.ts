import type { SiteSetting } from "@storyshelf/core/schema";
import { getTableColumns, getTableName } from "drizzle-orm";
import { expect, expectTypeOf, it } from "vitest";
import { DDL } from "../ddl.ts";
import { schema } from "./index.ts";
import { siteSettings } from "./site-setting.ts";

it("types site_settings rows exactly as core's SiteSetting", () => {
  expectTypeOf<SiteSetting>().toEqualTypeOf<typeof siteSettings.$inferSelect>();
  expect(schema.siteSettings).toBe(siteSettings);
  expect(getTableName(siteSettings)).toBe("site_settings");
});

it("creates site_settings in the DDL, column for column", () => {
  const table = /CREATE TABLE IF NOT EXISTS site_settings \((?<body>[^;]*)\);/u.exec(DDL)?.groups?.[
    "body"
  ];
  expect(table).toBeDefined();
  for (const column of Object.values(getTableColumns(siteSettings))) {
    expect(table, column.name).toMatch(new RegExp(`^\\s*${column.name} `, "mu"));
  }
});
