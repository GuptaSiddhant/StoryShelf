import { describe, expect, it, vi } from "vitest";
import { makeFakeStateNotifier } from "../../test-helpers/fake-notifier.ts";
import { buildCommentMarkdown, emitBuildState, statusContext } from "./state.ts";
import type { NotificationChannel } from "./types.ts";

function channel(overrides: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    id: "c1",
    projectId: "p1",
    provider: "fake-git",
    config: {},
    secret: "token",
    events: [],
    enabled: true,
    ...overrides,
  };
}

const base = { sha: "abc", url: "https://shelf/b/1", status: "testing" } as const;

describe("statusContext", () => {
  it("defaults the prefix to storyshelf and uses the configured one", () => {
    expect(statusContext(channel(), "testing")).toBe("storyshelf/testing");
    expect(statusContext(channel({ config: { prefix: "storyshelf-docs" } }), "review")).toBe(
      "storyshelf-docs/review",
    );
    expect(statusContext(channel({ config: { prefix: "" } }), "testing")).toBe(
      "storyshelf/testing",
    );
  });
});

describe("buildCommentMarkdown", () => {
  it("links the build under the status name for every state", () => {
    expect(buildCommentMarkdown("pending", "u", "s/testing")).toContain("pending for `s/testing`");
    expect(buildCommentMarkdown("success", "u", "s/testing")).toContain("passed for `s/testing`");
    expect(buildCommentMarkdown("failure", "u", "s/testing")).toContain("detected for `s/testing`");
    expect(buildCommentMarkdown("failure", "https://shelf/b/1", "c")).toContain(
      "(https://shelf/b/1)",
    );
  });
});

describe("emitBuildState", () => {
  it("writes status then comment to each enabled state channel with its token", async () => {
    const fake = makeFakeStateNotifier();
    await emitBuildState({
      ...base,
      state: "pending",
      notifiers: [fake.provider],
      channels: [channel(), channel({ id: "c2", config: { prefix: "alt" } })],
    });
    const statuses = fake.calls.filter((call) => call.target.kind === "status");
    expect(statuses.map((call) => call.target)).toEqual(
      expect.arrayContaining([
        { kind: "status", sha: "abc", context: "storyshelf/testing" },
        { kind: "status", sha: "abc", context: "alt/testing" },
      ]),
    );
    expect(fake.calls.filter((call) => call.target.kind === "comment")).toHaveLength(2);
    expect(fake.secrets).toEqual(["token", "token"]);
  });

  it("ignores disabled channels, message providers and unwired kinds", async () => {
    const fake = makeFakeStateNotifier();
    await emitBuildState({
      ...base,
      state: "success",
      notifiers: [fake.provider],
      channels: [
        channel({ enabled: false }),
        channel({ id: "c2", provider: "slack-webhook" }),
        channel({ id: "c3", provider: "unwired" }),
      ],
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("reports each channel's outcome, with the failure sanitized, and never throws", async () => {
    const failing = makeFakeStateNotifier("fake-git", "HTTP 401: Bad credentials");
    const onOutcome = vi.fn();
    const warn = vi.fn();
    await expect(
      emitBuildState({
        ...base,
        state: "failure",
        notifiers: [failing.provider],
        channels: [channel()],
        onOutcome,
        logger: { warn } as never,
      }),
    ).resolves.toBeUndefined();
    expect(onOutcome).toHaveBeenCalledWith({ channelId: "c1", error: "HTTP 401: Bad credentials" });
    expect(warn).toHaveBeenCalled();
  });

  it("reports success without an error and survives a comment failure", async () => {
    const fake = makeFakeStateNotifier();
    const original = fake.provider.create;
    fake.provider.create = (opts) => {
      const adapter = original(opts);
      return {
        ...adapter,
        setState: async (input) => {
          if (input.target.kind === "comment") {
            throw new Error("no pull request");
          }
          await adapter.setState(input);
        },
      };
    };
    const onOutcome = vi.fn();
    await emitBuildState({
      ...base,
      state: "success",
      notifiers: [fake.provider],
      channels: [channel()],
      onOutcome,
    });
    expect(onOutcome).toHaveBeenCalledWith({ channelId: "c1" });
    expect(fake.calls).toHaveLength(1);
  });
});
