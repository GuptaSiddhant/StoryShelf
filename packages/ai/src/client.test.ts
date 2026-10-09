import { describe, expect, it } from "vitest";
import {
  effectiveSlot,
  modelId,
  pickDefaultProfile,
  resolveSlot,
  validateOptions,
} from "./client.ts";
import { mockModel } from "./test-support.ts";

const m = (): ReturnType<typeof mockModel> => mockModel(["x"]);

describe("slots", () => {
  it("applies task defaults to a bare model and honours object overrides", () => {
    const bare = resolveSlot(m(), "triage");
    expect([bare.maxTokens, bare.timeoutMs, bare.declaredVision]).toEqual([
      1500,
      60_000,
      undefined,
    ]);
    expect(resolveSlot(m(), "health").maxTokens).toBe(4000);
    const obj = resolveSlot({ model: m(), maxTokens: 9, vision: true, timeoutMs: 5 }, "triage");
    expect([obj.maxTokens, obj.timeoutMs, obj.declaredVision]).toEqual([9, 5, true]);
  });
});

describe("effectiveSlot (vision rules)", () => {
  it("assumes a bare model in the vision slot is vision-capable", () => {
    expect(
      effectiveSlot({ defaultModel: m(), models: { vision: m() } }, "triage", true).vision,
    ).toBe(true);
  });

  it("lets an explicit vision:false win over placement", () => {
    const slot = effectiveSlot(
      { defaultModel: m(), models: { vision: { model: m(), vision: false } } },
      "triage",
      true,
    );
    expect(slot.vision).toBe(false);
  });

  it("requires a declared flag for an inherited default and is conservative otherwise", () => {
    expect(effectiveSlot({ defaultModel: m() }, "triage").vision).toBe(false);
    expect(effectiveSlot({ defaultModel: { model: m(), vision: true } }, "triage").vision).toBe(
      true,
    );
  });

  it("disables images with vision:null and never uses vision for health", () => {
    expect(
      effectiveSlot(
        { defaultModel: { model: m(), vision: true }, models: { vision: null } },
        "triage",
      ).vision,
    ).toBe(false);
    expect(effectiveSlot({ defaultModel: m(), models: { vision: m() } }, "health").vision).toBe(
      false,
    );
  });

  it("uses the task slot over the default model", () => {
    const task = m();
    expect(effectiveSlot({ defaultModel: m(), models: { health: task } }, "health").model).toBe(
      task,
    );
  });
});

describe("options", () => {
  it("validates profiles and default profile names", () => {
    expect(() => validateOptions({ profiles: {} })).toThrow(/at least one/u);
    expect(() => validateOptions({ profiles: { "": { defaultModel: m() } } })).toThrow(
      /non-empty/u,
    );
    expect(() =>
      validateOptions({ profiles: { a: { defaultModel: m() } }, defaultProfile: "zzz" as "a" }),
    ).toThrow(/unknown defaultProfile/u);
  });

  it("picks explicit, then `default`, then the first key", () => {
    const profiles = { x: { defaultModel: m() }, default: { defaultModel: m() } };
    expect(pickDefaultProfile({ profiles })).toBe("default");
    expect(pickDefaultProfile({ profiles, defaultProfile: "x" })).toBe("x");
    expect(pickDefaultProfile({ profiles: { first: { defaultModel: m() } } })).toBe("first");
  });

  it("identifies models by provider and id (or the gateway string)", () => {
    expect(modelId(m())).toContain(":");
    expect(modelId("openai/gpt-x")).toBe("openai/gpt-x");
  });
});

describe("slot provider options", () => {
  it("keeps them on the object form and defaults to none on a bare model", () => {
    const options = { anthropic: { thinking: { type: "disabled" } } };
    expect(resolveSlot({ model: m(), providerOptions: options }, "triage").providerOptions).toEqual(
      options,
    );
    expect(resolveSlot(m(), "triage").providerOptions).toBeUndefined();
  });
});

describe("vision slot routing", () => {
  it("uses the vision model only when images are sent", () => {
    const base = m();
    const vision = m();
    const profile = { defaultModel: base, models: { vision } };
    expect(effectiveSlot(profile, "triage").model).toBe(base);
    expect(effectiveSlot(profile, "triage", true).model).toBe(vision);
  });
});
