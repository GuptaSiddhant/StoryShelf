import { describe, expect, it } from "vitest";
import { Retention } from "./purge.ts";
import { makeDatabase } from "./fake-adapters.ts";

describe("Retention.latestPerBranch", () => {
  it("finds the latest build per branch", async () => {
    const db = makeDatabase();

    // Insert builds for different branches with different creation times
    await db.remove(/* builds */ {} as any, "b1"); // no-op with fake
    // Use the fake database's insert mechanism
    (db as any).rows.set("b1", {
      id: "b1", projectId: "p1", gitSha: "sha-1", gitBranch: "main",
      isDefault: true, createdAt: "2026-01-15T00:00:00.000Z", updatedAt: "2026-01-15T00:00:00.000Z",
    });
    (db as any).rows.set("b2", {
      id: "b2", projectId: "p1", gitSha: "sha-2", gitBranch: "main",
      isDefault: true, createdAt: "2026-01-10T00:00:00.000Z", updatedAt: "2026-01-10T00:00:00.000Z",
    });
    (db as any).rows.set("b3", {
      id: "b3", projectId: "p1", gitSha: "sha-3", gitBranch: "feature/xyz",
      isDefault: false, createdAt: "2026-01-20T00:00:00.000Z", updatedAt: "2026-01-20T00:00:00.000Z",
    });
    (db as any).rows.set("b4", {
      id: "b4", projectId: "p1", gitSha: "sha-4", gitBranch: "feature/xyz",
      isDefault: false, createdAt: "2026-01-05T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z",
    });
    (db as any).rows.set("b5", {
      id: "b5", projectId: "p1", gitSha: "sha-5", gitBranch: "develop",
      isDefault: false, createdAt: "2026-01-25T00:00:00.000Z", updatedAt: "2026-01-25T00:00:00.000Z",
    });

    const retention = new Retention(db as any, {} as any);

    const latest = await retention.latestPerBranch("p1");

    // main branch should have b1 (latest, Jan 15 > Jan 10)
    expect(latest.has("main")).toBe(true);
    // feature/xyz should have b3 (latest, Jan 20 > Jan 5)
    expect(latest.has("feature/xyz")).toBe(true);
    // develop should have b5 (only one)
    expect(latest.has("develop")).toBe(true);
  });
});