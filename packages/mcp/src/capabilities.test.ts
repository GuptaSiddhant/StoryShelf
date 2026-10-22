import { describe, expect, it, vi } from "vitest";
import { probeCapabilities, toolsFor } from "./capabilities.ts";
import type { ApiClient } from "./client.ts";
import { ALL_TOOLS } from "./tools/index.ts";

const clientOf = (get: ApiClient["get"]): ApiClient => ({
  defaultSlug: undefined,
  get,
  post: vi.fn(),
});

describe("probeCapabilities", () => {
  it("reads whether the instance has testing from its liveness body", async () => {
    const get = vi.fn().mockResolvedValue({ status: "ok", testing: false });
    await expect(probeCapabilities(clientOf(get as never))).resolves.toEqual({ testing: false });
    expect(get).toHaveBeenCalledWith("/health");
  });

  it("assumes testing when the instance does not say or cannot be reached", async () => {
    const silent = clientOf(vi.fn().mockResolvedValue({ status: "ok" }) as never);
    await expect(probeCapabilities(silent)).resolves.toEqual({ testing: true });
    const down = clientOf(vi.fn().mockRejectedValue(new Error("down")) as never);
    await expect(probeCapabilities(down)).resolves.toEqual({ testing: true });
  });
});

describe("toolsFor", () => {
  it("drops the tools that call testing routes when the instance has no testing", () => {
    const names = toolsFor(ALL_TOOLS, { testing: false }).map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["list_projects", "get_build", "list_builds", "add_comment"]),
    );
    for (const gone of [
      "list_snapshots",
      "get_capture_logs",
      "get_build_insight",
      "get_project_health",
    ]) {
      expect(names).not.toContain(gone);
    }
  });

  it("keeps every tool when the instance has testing", () => {
    expect(toolsFor(ALL_TOOLS, { testing: true })).toHaveLength(ALL_TOOLS.length);
  });
});
