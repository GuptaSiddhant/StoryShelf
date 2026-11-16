import { describe, expect, it, vi } from "vitest";
import { requestOpenBuildStates, tryRequestOpenBuildStates } from "./resume.ts";
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

  it("does not ask for a skipped build: it follows its source, never resumes (ADR 0044)", async () => {
    const w = await world();
    await w.builds.setStatus(w.build.id, "approved");
    const skipped = await w.builds.createSkipped({
      projectId: w.project.id,
      gitSha: "fedcba987654",
      gitBranch: "main",
      sourceBuildId: w.build.id,
      changedFiles: [],
    });
    const request = vi.fn(async (_id: string) => {});
    await expect(requestOpenBuildStates(w.deps, { request })).resolves.toBe(0);
    expect(request.mock.calls.map(([id]) => id)).not.toContain(skipped.id);
  });

  it("skips open builds that have no git commit to show state on", async () => {
    const w = await world();
    await w.builds.create(w.project.id, { gitSha: "", gitBranch: "main" });
    await w.builds.create(w.project.id, { gitSha: "local-abc123def456", gitBranch: "main" });
    const request = vi.fn(async (_id: string) => {});
    const asked = await requestOpenBuildStates(w.deps, { request });
    expect(asked).toBe(1);
    expect(request.mock.calls.map(([id]) => id)).toEqual([w.build.id]);
  });

  it("narrows to one project and one channel for an operator retry", async () => {
    const w = await world();
    const request = vi.fn(async (_id: string, _only?: { channelId?: string }) => {});
    const asked = await requestOpenBuildStates(
      w.deps,
      { request },
      { projectId: w.project.id, channelId: "chan-1" },
    );
    expect(asked).toBe(1);
    expect(request.mock.calls).toEqual([[w.build.id, { channelId: "chan-1" }]]);
    request.mockClear();
    await expect(
      requestOpenBuildStates(w.deps, { request }, { projectId: "other-project" }),
    ).resolves.toBe(0);
    expect(request).not.toHaveBeenCalled();
  });

  it("never rejects", async () => {
    const w = await world();
    const request = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(requestOpenBuildStates(w.deps, { request })).resolves.toBe(0);
  });

  describe("tryRequestOpenBuildStates", () => {
    it("tells how many open builds were asked, and 0 when none is open", async () => {
      const w = await world();
      const request = vi.fn(async (_id: string) => {});
      await expect(tryRequestOpenBuildStates(w.deps, { request })).resolves.toEqual({
        ok: true,
        asked: 1,
      });
      await expect(
        tryRequestOpenBuildStates(w.deps, { request }, { projectId: "other-project" }),
      ).resolves.toEqual({ ok: true, asked: 0 });
    });

    it("tells a failed lookup apart from nothing to ask, logging it once with the error", async () => {
      const w = await world();
      const warn = vi.spyOn(w.deps.logger, "warn");
      const request = vi.fn(async () => {
        throw new Error("boom");
      });
      await expect(tryRequestOpenBuildStates(w.deps, { request })).resolves.toEqual({
        ok: false,
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatchObject({ err: expect.any(Error) });
    });
  });
});
