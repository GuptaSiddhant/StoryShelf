import { describe, expect, it, vi } from "vitest";
import { createAi } from "./index.ts";
import { unsupportedModels } from "./lifecycle.ts";
import { TRIAGE_JSON, mockModel } from "./test-support.ts";

describe("createAi", () => {
  it("exposes profiles, defaults, budget and limits", () => {
    const ai = createAi({
      profiles: {
        fast: { defaultModel: mockModel([TRIAGE_JSON]) },
        default: { defaultModel: mockModel([TRIAGE_JSON]) },
      },
      budget: { dailyTokens: 1000 },
      limits: { maxImages: 1 },
    });
    expect(ai.profileNames()).toEqual(["fast", "default"]);
    expect(ai.defaultProfile()).toBe("default");
    expect(ai.budget()).toEqual({ dailyTokens: 1000, visionWeight: 5, perProjectCallsPerHour: 50 });
    expect(ai.limits()).toEqual({ maxImages: 1 });
    expect(ai.timeoutMs(undefined, "triage")).toBe(60_000);
    expect(ai.timeoutMs("fast", "health")).toBe(180_000);
    expect(ai.modelId(undefined, "triage")).toContain(":");
  });

  it("omits dailyTokens when not capped and binds a logger", async () => {
    const ai = createAi({ profiles: { default: { defaultModel: mockModel([TRIAGE_JSON]) } } });
    expect(ai.budget()).toEqual({ visionWeight: 5, perProjectCallsPerHour: 50 });
    ai.setLogger?.({ info: vi.fn(), warn: vi.fn() } as never);
    await expect(ai.health()).resolves.toEqual({ ok: true });
    await expect(ai.setup()).resolves.toBeUndefined();
    await expect(ai.teardown()).resolves.toBeUndefined();
  });

  it("fails setup and health for models the pinned core cannot drive", async () => {
    const odd = { specificationVersion: "v9", provider: "p", modelId: "m" } as never;
    const ai = createAi({ profiles: { default: { defaultModel: odd } } });
    await expect(ai.setup()).rejects.toThrow(/unsupported model specification/u);
    expect((await ai.health()).ok).toBe(false);
  });

  it("rejects an invalid configuration at creation", () => {
    expect(() => createAi({ profiles: {} })).toThrow();
  });

  it("lists unsupported models by id", () => {
    const odd = { specificationVersion: "v9", provider: "p", modelId: "m" } as never;
    expect(
      unsupportedModels({
        profiles: { a: { defaultModel: odd } },
        defaultProfile: "a",
        budget: { visionWeight: 5, perProjectCallsPerHour: 1 },
        limits: {},
      }),
    ).toContain("p:m");
  });
});
