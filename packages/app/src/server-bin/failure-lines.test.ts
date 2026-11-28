import { describe, expect, it } from "vitest";
import { failureLines } from "./failure-lines.ts";

describe("failureLines", () => {
  it("gives each failed adapter's reason as one line", () => {
    const error = Object.assign(new Error("Adapter setup failed: database/postgres"), {
      failures: [
        {
          category: "database",
          kind: "postgres",
          name: "Postgres",
          error: "cannot start the database at 127.0.0.1:5999/shelf: ECONNREFUSED",
        },
        { category: "storage", kind: "local", name: "Local", error: "" },
      ],
    });
    expect(failureLines(error)).toEqual([
      "  database/postgres: cannot start the database at 127.0.0.1:5999/shelf: ECONNREFUSED",
    ]);
  });

  it("is empty for an error without failures", () => {
    expect(failureLines(new Error("x"))).toEqual([]);
    expect(failureLines(null)).toEqual([]);
  });
});
