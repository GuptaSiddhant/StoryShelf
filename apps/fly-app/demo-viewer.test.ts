import { describe, expect, it, vi } from "vitest";
import { DEMO_PROJECT_SLUG, DEMO_VIEWER_EMAIL, ensureDemoViewer } from "./demo-viewer.ts";
import type { DemoViewerDeps } from "./demo-viewer.ts";

function deps(over: Partial<DemoViewerDeps> = {}): DemoViewerDeps {
  return {
    findUserId: vi.fn(async () => null),
    createUser: vi.fn(async () => "u1"),
    projectId: vi.fn(async () => "p1"),
    isMember: vi.fn(async () => false),
    addViewer: vi.fn(async () => {}),
    ...over,
  };
}

describe("ensureDemoViewer", () => {
  it("does nothing without a password", async () => {
    const d = deps();
    expect(await ensureDemoViewer(d, "")).toEqual({
      userCreated: false,
      memberAdded: false,
    });
    expect(d.findUserId).not.toHaveBeenCalled();
  });

  it("creates the user and makes it a viewer of storyshelf-ui", async () => {
    const d = deps();
    expect(await ensureDemoViewer(d, "a-long-password")).toEqual({
      userCreated: true,
      memberAdded: true,
    });
    expect(d.createUser).toHaveBeenCalledWith(DEMO_VIEWER_EMAIL, "a-long-password");
    expect(d.projectId).toHaveBeenCalledWith(DEMO_PROJECT_SLUG);
    expect(d.addViewer).toHaveBeenCalledWith("p1", "u1");
  });

  it("is a no-op when the user is already a member", async () => {
    const d = deps({ findUserId: async () => "u1", isMember: async () => true });
    expect(await ensureDemoViewer(d, "a-long-password")).toEqual({
      userCreated: false,
      memberAdded: false,
    });
    expect(d.createUser).not.toHaveBeenCalled();
    expect(d.addViewer).not.toHaveBeenCalled();
  });

  it("creates the user but waits for a project that does not exist yet", async () => {
    const d = deps({ projectId: async () => null });
    expect(await ensureDemoViewer(d, "a-long-password")).toEqual({
      userCreated: true,
      memberAdded: false,
    });
    expect(d.addViewer).not.toHaveBeenCalled();
  });
});
