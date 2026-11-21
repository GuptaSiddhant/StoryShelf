import type { GitConnectionRow, GitRepositoryLinkRow } from "@storyshelf/core/schema";
import { getTableColumns, getTableName } from "drizzle-orm";
import { expect, expectTypeOf, it } from "vitest";
import { DDL } from "../ddl.ts";
import { gitConnections, gitRepositoryLinks } from "./git-connection.ts";
import { schema } from "./index.ts";

it("types the git tables exactly as core's row types", () => {
  expectTypeOf<GitConnectionRow>().toEqualTypeOf<typeof gitConnections.$inferSelect>();
  expectTypeOf<GitRepositoryLinkRow>().toEqualTypeOf<typeof gitRepositoryLinks.$inferSelect>();
  expect(schema.gitConnections).toBe(gitConnections);
  expect(schema.gitRepositoryLinks).toBe(gitRepositoryLinks);
  expect(getTableName(gitConnections)).toBe("git_connections");
  expect(getTableName(gitRepositoryLinks)).toBe("git_repository_links");
});

it("creates both git tables in the DDL, column for column", () => {
  for (const [name, table] of [
    ["git_connections", gitConnections],
    ["git_repository_links", gitRepositoryLinks],
  ] as const) {
    const body = new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\((?<body>[^;]*)\\);`, "u").exec(
      DDL,
    )?.groups?.["body"];
    expect(body, name).toBeDefined();
    for (const column of Object.values(getTableColumns(table))) {
      expect(body, `${name}.${column.name}`).toMatch(new RegExp(`^\\s*${column.name} `, "mu"));
    }
  }
  expect(DDL).toContain(
    "git_repository_links_repository_idx ON git_repository_links (host, owner, repo, prefix)",
  );
});
