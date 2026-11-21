import { describe, expect, it } from "vitest";
import { compareDdlShapes } from "./ddl-diff.ts";
import { ddlShape } from "./ddl-shape.ts";

const TODAY = `
CREATE TABLE IF NOT EXISTS t (
  id TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  email TEXT NOT NULL UNIQUE,
  p TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT CHECK (kind IN ('a'))
);
CREATE INDEX IF NOT EXISTS t_n_idx ON t (n);
`;

describe("compareDdlShapes", () => {
  it("finds nothing between equivalent spellings", () => {
    const generated = `
CREATE TABLE "t" (
  "id" text PRIMARY KEY NOT NULL,
  "n" int4 DEFAULT 0 NOT NULL,
  "email" text NOT NULL,
  "p" text,
  "kind" text,
  CONSTRAINT "t_email_key" UNIQUE("email"),
  CONSTRAINT "t_kind_check" CHECK (kind IN ('a'))
);
ALTER TABLE "t" ADD CONSTRAINT "t_p_fkey" FOREIGN KEY ("p") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "t_n_idx" ON "t" USING btree ("n");`;
    expect(compareDdlShapes(["t"], ddlShape(TODAY, "pg"), ddlShape(generated, "pg"))).toEqual([]);
  });

  it("reports every planted difference", () => {
    const generated = `
CREATE TABLE "t" (
  "id" text PRIMARY KEY NOT NULL,
  "n" bigint DEFAULT 1,
  "email" text NOT NULL,
  "p" text,
  "extra" text,
  CONSTRAINT "t_email_unique" UNIQUE("email"),
  CONSTRAINT "t_kind_check" CHECK (kind IN ('b'))
);
ALTER TABLE "t" ADD CONSTRAINT "t_p_fkey" FOREIGN KEY ("p") REFERENCES "projects"("id") ON DELETE restrict;
CREATE INDEX "t_n_idx" ON "t" ("n", "id");
CREATE INDEX "t_new_idx" ON "t" ("p");`;
    expect(
      compareDdlShapes(["t", "gone"], ddlShape(TODAY, "pg"), ddlShape(generated, "pg")),
    ).toEqual([
      't.n: type "integer" → "bigint"',
      "t.n: notNull true → false",
      't.n: defaultValue "0" → "1"',
      "t.kind: column only today",
      "t.extra: column only generated",
      "t unique (email): name t_email_key → t_email_unique",
      "t foreign key (p): projects(id) on delete cascade → projects(id) on delete restrict",
      "t check kind in ('a'): only today",
      "t check kind in ('b'): only generated",
      "gone: table in neither",
      'index t_n_idx: {"name":"t_n_idx","columns":["n"],"table":"t","where":null} → {"name":"t_n_idx","columns":["n","id"],"table":"t","where":null}',
      "index t_new_idx: only generated",
    ]);
  });
});

it("reports a table on one side only", () => {
  const only = ddlShape("CREATE TABLE a (id TEXT)", "sqlite");
  const none = ddlShape("", "sqlite");
  expect(compareDdlShapes(["a"], only, none)).toEqual(["a: table only today"]);
  expect(compareDdlShapes(["a"], none, only)).toEqual(["a: table only generated"]);
});
