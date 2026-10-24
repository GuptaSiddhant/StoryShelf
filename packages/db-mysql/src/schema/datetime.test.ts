import { describe, expect, it } from "vitest";
import { fromMySqlDateTime, toMySqlDateTime } from "./datetime.ts";

describe("MySQL datetime columns", () => {
  it("stores ISO timestamps in MySQL DATETIME form", () => {
    expect(toMySqlDateTime("2026-10-24T10:34:17.691Z")).toBe("2026-10-24 10:34:17.691");
  });

  it("returns MySQL DATETIME values as ISO timestamps", () => {
    expect(fromMySqlDateTime("2026-10-24 10:34:17.691")).toBe("2026-10-24T10:34:17.691Z");
  });

  it("leaves already-ISO and malformed values unchanged", () => {
    expect(fromMySqlDateTime("2026-10-24T10:34:17.691Z")).toBe("2026-10-24T10:34:17.691Z");
    expect(toMySqlDateTime("not-a-date")).toBe("not-a-date");
    expect(fromMySqlDateTime("not-a-date")).toBe("not-a-date");
  });
});
