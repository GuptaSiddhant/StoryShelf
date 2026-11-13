import { describe, expect, it } from "vitest";
import { applyConnectionPragmas } from "./pragmas.ts";

describe("applyConnectionPragmas", () => {
  it("sets WAL, synchronous=NORMAL and busy_timeout by default", () => {
    const statements: string[] = [];
    applyConnectionPragmas((sql) => statements.push(sql));
    expect(statements).toEqual([
      "PRAGMA journal_mode = WAL",
      "PRAGMA synchronous = NORMAL",
      "PRAGMA busy_timeout = 5000",
    ]);
  });

  it("opts out to synchronous=FULL", () => {
    const statements: string[] = [];
    applyConnectionPragmas((sql) => statements.push(sql), { synchronous: "full" });
    expect(statements).toContain("PRAGMA synchronous = FULL");
    expect(statements).not.toContain("PRAGMA synchronous = NORMAL");
  });
});
