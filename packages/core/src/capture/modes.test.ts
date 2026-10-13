import { describe, expect, it } from "vitest";
import type { Viewport } from "./adapter.ts";
import {
  applyModes,
  buildGlobalsParam,
  filterModes,
  modeSlug,
  parseModesAllowlist,
} from "./modes.ts";
import { StorybookAdapter, mergeParameters, resolveStoryViewports } from "./storybook.ts";

const BASE: Viewport[] = [{ name: "desktop", width: 1280, height: 720 }];
const none = (): undefined => undefined;
const lookup = (name: string): Viewport | undefined =>
  name === "small" ? { name: "small", width: 320, height: 568 } : undefined;

describe("modeSlug", () => {
  it("normalizes case, whitespace and punctuation", () => {
    expect(modeSlug("Dark Desktop")).toBe("dark-desktop");
    expect(modeSlug("  dark   desktop ")).toBe("dark-desktop");
    expect(modeSlug("1200px")).toBe("1200px");
    expect(modeSlug("../x")).toBe("x");
  });

  it("rejects names without usable characters", () => {
    expect(() => modeSlug("   ")).toThrow(/Invalid mode name/u);
    expect(() => modeSlug("***")).toThrow(/Invalid mode name/u);
  });
});

describe("applyModes", () => {
  it("returns the base list without modes", () => {
    expect(applyModes(undefined, BASE, none)).toEqual(BASE);
  });

  it("adds a globals mode inheriting the first viewport size", () => {
    expect(applyModes({ Dark: { theme: "dark" } }, BASE, none)).toEqual([
      ...BASE,
      { name: "dark", width: 1280, height: 720, globals: { theme: "dark" } },
    ]);
  });

  it("resolves numeric, named and explicit viewports", () => {
    const result = applyModes(
      {
        wide: { viewport: 1600 },
        mobile: { viewport: "small", theme: "light" },
        box: { viewport: { width: 500, height: 400 } },
        unknown: { viewport: "nope" },
      },
      BASE,
      lookup,
    );
    expect(result.slice(1)).toEqual([
      { name: "wide", width: 1600, height: 720 },
      { name: "mobile", width: 320, height: 568, globals: { theme: "light" } },
      { name: "box", width: 500, height: 400 },
      { name: "unknown", width: 1280, height: 720 },
    ]);
  });

  it("replaces a viewport with the same slug and drops disabled ones", () => {
    const result = applyModes(
      { Desktop: { theme: "dark" }, tablet: { disable: true } },
      [...BASE, { name: "tablet", width: 834, height: 1112 }],
      none,
    );
    expect(result).toEqual([
      { name: "desktop", width: 1280, height: 720, globals: { theme: "dark" } },
    ]);
  });
});

describe("filterModes / parseModesAllowlist", () => {
  const modes = { dark: { theme: "dark" }, Light: { theme: "light" }, off: { disable: true } };

  it("keeps all modes without an allowlist", () => {
    expect(filterModes(modes, null)).toBe(modes);
    expect(filterModes(modes, [])).toBe(modes);
    expect(filterModes(undefined, ["dark"])).toBeUndefined();
  });

  it("filters by slug but always keeps disable markers", () => {
    expect(Object.keys(filterModes(modes, ["LIGHT"]) ?? {})).toEqual(["Light", "off"]);
  });

  it("parses the stored JSON list", () => {
    expect(parseModesAllowlist('["a","b"]')).toEqual(["a", "b"]);
    expect(parseModesAllowlist("[1]")).toBeNull();
    expect(parseModesAllowlist("nope")).toBeNull();
    expect(parseModesAllowlist(null)).toBeNull();
  });
});

describe("buildGlobalsParam", () => {
  it("encodes scalars, nested objects and special values", () => {
    expect(
      buildGlobalsParam({
        theme: "dark",
        backgrounds: { value: "#1E293B" },
        rtl: true,
        grid: false,
        nothing: null,
        gone: undefined,
        count: 2,
      }),
    ).toBe(
      "theme:dark;backgrounds.value:!hex(1E293B);rtl:!true;grid:!false;nothing:!null;gone:!undefined;count:2",
    );
    expect(buildGlobalsParam({})).toBe("");
  });
});

describe("storybook integration", () => {
  it("merges chromatic and storyshelf modes per name (storyshelf wins)", () => {
    const merged = mergeParameters({
      parameters: {
        chromatic: { modes: { dark: { theme: "dark" }, light: { theme: "light" } } },
        storyshelf: { modes: { dark: { theme: "night" } } },
      },
    });
    expect(merged?.modes).toEqual({ dark: { theme: "night" }, light: { theme: "light" } });
  });

  it("adds story modes in resolveStoryViewports, resolving builtin viewport names", () => {
    const viewports = resolveStoryViewports(
      {
        parameters: {
          modes: { phone: { viewport: "mobile1", theme: "dark" } },
        },
      },
      BASE,
    );
    expect(viewports).toEqual([
      ...BASE,
      { name: "phone", width: 320, height: 568, globals: { theme: "dark" } },
    ]);
  });

  it("appends globals to the iframe url", () => {
    const adapter = new StorybookAdapter();
    expect(adapter.buildUrl("http://x", "a--b")).toBe(
      "http://x/iframe.html?id=a--b&viewMode=story",
    );
    expect(adapter.buildUrl("http://x", "a--b", { theme: "dark", rtl: true })).toBe(
      `http://x/iframe.html?id=a--b&viewMode=story&globals=${encodeURIComponent("theme:dark;rtl:!true")}`,
    );
    expect(adapter.buildUrl("http://x", "a--b", {})).toBe(
      "http://x/iframe.html?id=a--b&viewMode=story",
    );
  });
});
