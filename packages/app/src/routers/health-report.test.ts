import { describe, expect, it } from "vitest";
import { collectHealthReport } from "./health-report.ts";

function sources(): Parameters<typeof collectHealthReport>[0] {
  const storage = {
    metadata: { name: "Local", version: "0.0.0", kind: "local", category: "storage" },
  };
  const database = {
    metadata: { name: "SQLite", version: "0.0.0", kind: "sqlite", category: "database" },
  };
  return { database, storage } as never;
}

describe("collectHealthReport", () => {
  it("redacts secrets in setup failure details", async () => {
    const report = await collectHealthReport(
      sources(),
      {
        ok: false,
        failures: [
          {
            category: "storage",
            kind: "local",
            name: "Local",
            error: "connect postgres://user:s3cret@host/db failed",
          },
        ],
      },
      Date.now(),
      "0.0.0",
    );
    const entry = report.adapters.find((adapter) => adapter.kind === "local");
    expect(entry?.state).toBe("failed");
    expect(entry?.detail).not.toContain("s3cret");
    expect(entry?.detail).toContain("[redacted]");
    expect(report.status).toBe("degraded");
  });
});
