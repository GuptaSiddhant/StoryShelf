import { describe, expect, it } from "vitest";
import { defineShelfInstance, isShelfInstance } from "./instance-definition.ts";

const afterSetup = (): void => {};

describe("defineShelfInstance", () => {
  it("wraps the factory and its hooks in a branded definition", async () => {
    const options = { database: {}, storage: {} } as never;
    const instance = defineShelfInstance(async () => await Promise.resolve(options), {
      afterSetup,
    });
    expect(isShelfInstance(instance)).toBe(true);
    expect(instance.afterSetup).toBe(afterSetup);
    expect(await instance.factory({})).toBe(options);
  });

  it("has no hooks by default", () => {
    expect(defineShelfInstance(() => ({}) as never).afterSetup).toBeUndefined();
  });

  it("recognises only definitions, not apps or plain objects", () => {
    expect(isShelfInstance(null)).toBe(false);
    expect(isShelfInstance({ factory: () => 1 })).toBe(false);
    expect(isShelfInstance({ fetch: () => 1, lifecycle: {} })).toBe(false);
  });
});
