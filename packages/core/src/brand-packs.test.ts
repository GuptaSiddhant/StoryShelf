import { describe, expect, it } from "vitest";
import { brandPack, brandPacks } from "./brand-packs.ts";
import { uiConfigSchema } from "./config.ts";

describe("brand packs", () => {
  it("names the default pack and resolves lookups", () => {
    // oxlint-disable-next-line unicorn/no-array-sort, unicorn/no-useless-spread -- toSorted not available in type-aware lint lib
    expect([...Object.keys(brandPacks)].sort()).toEqual(["ocean", "storyshelf"]);
    expect(brandPack("ocean")).toBe(brandPacks["ocean"]);
    expect(brandPack("nope")).toBeUndefined();
  });

  it("sets an info status colour that is not the accent, and no top bar colour", () => {
    for (const [name, pack] of Object.entries(brandPacks)) {
      for (const theme of [pack.light, pack.dark]) {
        expect(theme.status.info, `pack ${name}`).toBeTruthy();
        expect(theme.status.info, `pack ${name}`).not.toBe(theme.accent);
        expect(theme.topbarBg, `pack ${name}`).toBeUndefined();
      }
    }
  });

  it("validates every pack against the UI config schema", () => {
    for (const [name, pack] of Object.entries(brandPacks)) {
      const result = uiConfigSchema.safeParse({ lightTheme: pack.light, darkTheme: pack.dark });
      expect(result.success, `pack ${name}`).toBe(true);
    }
  });
});
