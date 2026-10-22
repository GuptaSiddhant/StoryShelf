import { notifierContractSuite } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { gitLogNotifier } from "./log.ts";

notifierContractSuite("git-log", () => gitLogNotifier);

describe("gitLogNotifier", () => {
  it("is a state provider of kind git-log", () => {
    expect(gitLogNotifier.metadata).toMatchObject({
      kind: "git-log",
      delivery: "state",
      category: "notifier",
    });
  });

  it("logs the state it was asked to show", async () => {
    const info = vi.fn();
    const logger = { child: () => ({ info }) } as never;
    const adapter = gitLogNotifier.create({ config: {}, logger });
    await adapter.setState({
      channel: {
        id: "c1",
        projectId: "p1",
        provider: "git-log",
        config: {},
        events: [],
        enabled: true,
      },
      target: { kind: "status", sha: "abc", context: "storyshelf/testing" },
      state: "pending",
      url: "https://x/b/1",
    });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "c1", state: "pending" }),
      "git state (log)",
    );
  });

  it("works without a logger", async () => {
    const adapter = gitLogNotifier.create({ config: {} });
    await expect(
      adapter.setState({
        channel: {
          id: "c1",
          projectId: null,
          provider: "git-log",
          config: {},
          events: [],
          enabled: true,
        },
        target: { kind: "comment", sha: "abc", markdown: "m" },
        state: "success",
        url: "u",
      }),
    ).resolves.toBeUndefined();
  });
});
