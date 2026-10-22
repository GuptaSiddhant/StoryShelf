import { describe, expect, it, vi } from "vitest";
import { requestOpenBuildStates } from "./resume.ts";
import { world } from "./test-world.ts";

describe("requestOpenBuildStates", () => {
  it("asks for the builds that can still change, not the settled ones", async () => {
    const w = await world();
    const settled = await w.builds.create(w.project.id, { gitSha: "def456", gitBranch: "main" });
    await w.builds.setStatus(settled.id, "approved");
    const reviewing = await w.builds.create(w.project.id, { gitSha: "789abc", gitBranch: "x" });
    await w.builds.setStatus(reviewing.id, "reviewing");
    const request = vi.fn(async (_id: string) => {});
    const asked = await requestOpenBuildStates(w.deps, { request });
    expect(asked).toBe(2);
    const ids = request.mock.calls.map(([id]) => id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(w.build.id);
    expect(ids).toContain(reviewing.id);
  });

  it("never rejects", async () => {
    const w = await world();
    const request = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(requestOpenBuildStates(w.deps, { request })).resolves.toBe(0);
  });
});
