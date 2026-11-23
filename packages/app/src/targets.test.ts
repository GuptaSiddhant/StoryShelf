import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import { NO_SECRET_REASON, reachabilityOf } from "@storyshelf/core/capture";
import { describe, expect, it } from "vitest";
import { runWithStore, type Store } from "./store.ts";
import {
  assertTargetsSelectable,
  runnerTargets,
  targetLabel,
  targetStates,
  unreachableTargets,
} from "./targets.ts";
import { stubRunner } from "./test-runner.ts";

const storeOf = (partial: Partial<Store>): Store => ({ config: {}, ...partial }) as Store;

describe("targetLabel", () => {
  it("names the engine, and the remote's name for a remote target", () => {
    expect(targetLabel("chromium")).toBe("Chromium");
    expect(targetLabel("webkit")).toBe("WebKit");
    expect(targetLabel("firefox@pool-b")).toBe("Firefox on pool-b");
  });
});

describe("runnerTargets", () => {
  it("is undefined without a runner or without a list: any target is accepted", async () => {
    expect(await runnerTargets(storeOf({}))).toBeUndefined();
    expect(await runnerTargets(storeOf({ runner: stubRunner() }))).toBeUndefined();
  });

  it("marks URL targets unavailable until a secret and a public origin exist", async () => {
    const base = stubRunner();
    const runner = {
      ...base,
      metadata: {
        ...base.metadata,
        targets: [{ target: "chromium@grid", reach: "url", status: "ready" }],
      },
    } as CaptureRunner;
    const origin = { url: async () => await Promise.resolve("https://shelf.example.com") };
    const store = storeOf({ runner, config: { secret: "s" }, publicOrigin: origin as never });
    expect((await runnerTargets(store))?.[0]?.status).toBe("ready");
    expect((await runnerTargets(storeOf({ runner })))?.[0]?.status).toEqual({
      unavailable: NO_SECRET_REASON,
    });
  });
});

const inStore = async (run: () => Promise<void>): Promise<void> => {
  await runWithStore(storeOf({}), run);
};

describe("assertTargetsSelectable", () => {
  it("accepts any well-formed target when the runner publishes no list", async () => {
    await inStore(async () => {
      await expect(assertTargetsSelectable(["webkit", "chromium@grid"])).resolves.toBeUndefined();
    });
  });

  it("rejects a malformed target and more than three", async () => {
    await inStore(async () => {
      await expect(assertTargetsSelectable(["safari"])).rejects.toThrow(/Invalid capture target/u);
      await expect(
        assertTargetsSelectable(["chromium", "firefox", "webkit", "chrome"]),
      ).rejects.toThrow(/at most 3/u);
    });
  });
});

const runnerWith = (): CaptureRunner => {
  const base = stubRunner();
  return {
    ...base,
    metadata: {
      ...base.metadata,
      targets: [
        { target: "chromium", reach: "loopback", status: "ready" },
        { target: "chromium@sprite", reach: "loopback", status: "ready" },
      ],
    },
  } as CaptureRunner;
};

describe("targetStates", () => {
  it("is empty without a runner and has no unreachable target", async () => {
    expect(await targetStates(storeOf({}))).toEqual({});
    expect(unreachableTargets(storeOf({})).size).toBe(0);
  });

  it("reads ok for every offered target until one fails to launch, then until it renders", async () => {
    const runner = runnerWith();
    const store = storeOf({ runner });
    expect(await targetStates(store)).toEqual({ chromium: "ok", "chromium@sprite": "ok" });
    await reachabilityOf(runner).failed("chromium@sprite", "connection");
    expect(await targetStates(store)).toEqual({ chromium: "ok", "chromium@sprite": "unreachable" });
    expect(unreachableTargets(store).get("chromium@sprite")?.reason).toBe("connection");
    await reachabilityOf(runner).succeeded("chromium@sprite");
    expect(await targetStates(store)).toEqual({ chromium: "ok", "chromium@sprite": "ok" });
  });

  it("lists an unreachable target the runner no longer offers", async () => {
    const runner = stubRunner();
    await reachabilityOf(runner).failed("firefox", "launch");
    expect(await targetStates(storeOf({ runner }))).toEqual({ firefox: "unreachable" });
  });
});
