import { describe, expect, it } from "vitest";
import type { RunnerTarget } from "../adapters/capture-runner.ts";
import { offeredTargets } from "./targets.ts";

const runner = (targets?: RunnerTarget[]) => ({
  metadata: {
    name: "r",
    version: "0",
    kind: "r",
    category: "capture-runner" as const,
    ...(targets ? { targets } : {}),
  },
});

const local: RunnerTarget = { target: "chromium", reach: "loopback", status: "ready" };
const remote: RunnerTarget = { target: "chromium@grid", reach: "url", status: "ready" };
const broken: RunnerTarget = {
  target: "firefox@grid",
  reach: "url",
  status: { unavailable: "not installed" },
};

describe("offeredTargets", () => {
  it("is undefined for a runner with no list", () => {
    expect(offeredTargets(runner(), { publicOrigin: undefined, hasSecret: false })).toBeUndefined();
  });

  it("leaves loopback targets and ready URL targets with every prerequisite alone", () => {
    const targets = [local, remote];
    expect(
      offeredTargets(runner(targets), {
        publicOrigin: "https://shelf.example.com",
        hasSecret: true,
      }),
    ).toEqual(targets);
  });

  it("marks URL targets unavailable without a secret, then without a public origin", () => {
    expect(
      offeredTargets(runner([local, remote]), {
        publicOrigin: "https://x.example.com",
        hasSecret: false,
      }),
    ).toEqual([local, { ...remote, status: { unavailable: "no secret" } }]);
    expect(
      offeredTargets(runner([local, remote]), { publicOrigin: undefined, hasSecret: true }),
    ).toEqual([local, { ...remote, status: { unavailable: "no public origin" } }]);
  });

  it("keeps an unavailable target's own reason", () => {
    expect(offeredTargets(runner([broken]), { publicOrigin: undefined, hasSecret: false })).toEqual(
      [broken],
    );
  });
});
