import { describe, expect, it, vi } from "vitest";
import { makeFakeStateNotifier } from "../../test-helpers/fake-notifier.ts";
import type { BuildStateSet } from "./build-state.ts";
import { channelPrefix, writeBuildState } from "./state.ts";
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

const states: BuildStateSet = {
  statuses: [
    {
      name: "testing",
      context: "storyshelf/testing",
      state: "pending",
      description: "Capturing",
      url: "https://shelf/b/1",
    },
    {
      name: "storybook",
      context: "storyshelf/storybook",
      state: "success",
      description: "Storybook published",
      url: "https://shelf/sb/1",
    },
  ],
  comment: { url: "https://shelf/b/1", markdown: "body", state: "pending" },
};

describe("channelPrefix", () => {
  it("defaults the prefix to storyshelf and uses the configured one", () => {
    expect(channelPrefix(channel())).toBe("storyshelf");
    expect(channelPrefix(channel({ config: { prefix: "storyshelf-docs" } }))).toBe(
      "storyshelf-docs",
    );
    expect(channelPrefix(channel({ config: { prefix: "" } }))).toBe("storyshelf");
  });
});

describe("writeBuildState", () => {
  it("writes every status verbatim, then the comment, with the channel token", async () => {
    const fake = makeFakeStateNotifier();
    await writeBuildState(fake.provider, channel(), { sha: "abc", states });
    expect(fake.calls.map((call) => call.target)).toEqual([
      { kind: "status", sha: "abc", context: "storyshelf/testing", description: "Capturing" },
      {
        kind: "status",
        sha: "abc",
        context: "storyshelf/storybook",
        description: "Storybook published",
      },
      { kind: "comment", sha: "abc", markdown: "body" },
    ]);
    expect(fake.calls.map((call) => call.url)).toEqual([
      "https://shelf/b/1",
      "https://shelf/sb/1",
      "https://shelf/b/1",
    ]);
    expect(fake.secrets).toEqual(["token"]);
  });

  it("skips the comment when the states carry none", async () => {
    const fake = makeFakeStateNotifier();
    await writeBuildState(fake.provider, channel(), {
      sha: "abc",
      states: { ...states, comment: null },
    });
    expect(fake.calls.every((call) => call.target.kind === "status")).toBe(true);
  });

  it("throws when the host refuses a status, so the caller can retry", async () => {
    const failing = makeFakeStateNotifier("fake-git", "HTTP 401: Bad credentials");
    await expect(
      writeBuildState(failing.provider, channel(), { sha: "abc", states }),
    ).rejects.toThrow("HTTP 401");
  });

  it("survives a comment failure", async () => {
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
    const warn = vi.fn();
    await writeBuildState(fake.provider, channel(), {
      sha: "abc",
      states,
      logger: { warn } as never,
    });
    expect(fake.calls).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
  });
});
