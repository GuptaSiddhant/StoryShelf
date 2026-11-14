import { describe, expect, it, vi } from "vitest";
import { getMetadata } from "./log.ts";
import { createStateAdapter, requireToken, type StateWriter } from "./state-adapter.ts";

const channel = {
  id: "c1",
  projectId: "p1",
  provider: "github",
  config: {},
  events: [],
  enabled: true,
};

function writer(): StateWriter & {
  status: ReturnType<typeof vi.fn>;
  comment: ReturnType<typeof vi.fn>;
} {
  return { status: vi.fn().mockResolvedValue(null), comment: vi.fn().mockResolvedValue("1") };
}

describe("createStateAdapter", () => {
  it("routes a status target with the default description", async () => {
    const w = writer();
    const adapter = createStateAdapter(getMetadata(), w);
    await adapter.setState({
      channel,
      target: { kind: "status", sha: "abc", context: "storyshelf/testing" },
      state: "success",
      url: "https://x/b/1",
    });
    expect(w.status).toHaveBeenCalledWith({
      sha: "abc",
      context: "storyshelf/testing",
      state: "success",
      description: "Visual tests passed",
      url: "https://x/b/1",
    });
    expect(w.comment).not.toHaveBeenCalled();
  });

  it("keeps an explicit description", async () => {
    const w = writer();
    await createStateAdapter(getMetadata(), w).setState({
      channel,
      target: { kind: "status", sha: "abc", context: "c", description: "Review open" },
      state: "pending",
      url: "u",
    });
    expect(w.status).toHaveBeenCalledWith(expect.objectContaining({ description: "Review open" }));
  });

  it("routes a comment target", async () => {
    const w = writer();
    await createStateAdapter(getMetadata(), w).setState({
      channel,
      target: { kind: "comment", sha: "abc", markdown: "hello" },
      state: "failure",
      url: "https://x/b/1",
    });
    expect(w.comment).toHaveBeenCalledWith({ sha: "abc", url: "https://x/b/1", markdown: "hello" });
    expect(w.status).not.toHaveBeenCalled();
  });
});

const channelWithoutToken: { secret?: string } = {};

describe("requireToken", () => {
  it("returns the token or names the provider", () => {
    expect(requireToken("t", "GitHub")).toBe("t");
    expect(() => requireToken(channelWithoutToken.secret, "GitHub")).toThrow(
      "GitHub channel needs a token",
    );
    expect(() => requireToken("", "GitLab")).toThrow("GitLab channel needs a token");
  });
});
