import { describe, expect, it } from "vitest";
import {
  cleanIgnoreSelectors,
  declaredIgnoreSelectors,
  DEFAULT_IGNORE_SELECTORS,
  ignoreStylesheet,
  isSafeIgnoreSelector,
  MAX_IGNORE_SELECTORS,
} from "./ignore-regions.ts";
import { mergeParameters } from "./storybook.ts";

describe("cleanIgnoreSelectors", () => {
  it("trims, deduplicates and keeps order", () => {
    expect(cleanIgnoreSelectors([" .a ", ".b", ".a"])).toEqual({
      selectors: [".a", ".b"],
      skipped: [],
    });
  });

  it("skips non-strings, blanks and selectors that could close the rule", () => {
    const result = cleanIgnoreSelectors([
      1,
      "",
      "  ",
      ".ok",
      "a{}",
      ".x } body { display:none",
      "/*",
    ]);
    expect(result.selectors).toEqual([".ok"]);
    expect(result.skipped).toHaveLength(6);
  });

  it("yields nothing for a value that is not an array", () => {
    expect(cleanIgnoreSelectors(".a")).toEqual({ selectors: [], skipped: [] });
    expect(cleanIgnoreSelectors(null)).toEqual({ selectors: [], skipped: [] });
  });

  it("caps the list and reports the overflow", () => {
    const many = Array.from({ length: MAX_IGNORE_SELECTORS + 3 }, (_, i) => `.s${i}`);
    const result = cleanIgnoreSelectors(many);
    expect(result.selectors).toHaveLength(MAX_IGNORE_SELECTORS);
    expect(result.skipped).toEqual(many.slice(MAX_IGNORE_SELECTORS));
  });
});

describe("isSafeIgnoreSelector", () => {
  it("accepts attribute and combinator selectors", () => {
    expect(isSafeIgnoreSelector('[data-x="1"] > .y:not(.z)')).toBe(true);
    expect(isSafeIgnoreSelector("</style><script>")).toBe(false);
  });
});

describe("ignoreStylesheet", () => {
  it("always masks the default markers, one rule each, hiding without collapsing layout", () => {
    const css = ignoreStylesheet();
    for (const selector of DEFAULT_IGNORE_SELECTORS)
      expect(css).toContain(`${selector} { visibility: hidden !important; }`);
    expect(css).not.toContain("display");
  });

  it("hides descendants too, so a child that sets visibility: visible cannot show through", () => {
    const css = ignoreStylesheet([".clock"]);
    expect(css).toContain(".clock { visibility: hidden !important; }");
    expect(css).toContain(":is(.clock) * { visibility: hidden !important; }");
  });

  it("never emits an unsafe selector, even if one reaches it", () => {
    const css = ignoreStylesheet([".ok", "a{}", "x } body { display:none"]);
    expect(css).toContain(".ok {");
    expect(css).not.toContain("display");
    expect(css).not.toContain("a{}");
  });

  it("adds declared selectors once", () => {
    const css = ignoreStylesheet([".clock", ".clock", "[data-storyshelf-ignore]"]);
    expect(css.match(/^\.clock \{/gmu)).toHaveLength(1);
    expect(css.match(/\[data-storyshelf-ignore\] \{/gu)).toHaveLength(1);
  });
});

describe("declaredIgnoreSelectors", () => {
  it("keeps string entries untouched, leaving safety and the cap to the runner", () => {
    expect(declaredIgnoreSelectors([".a", 1, "b{}", null])).toEqual([".a", "b{}"]);
  });

  it("is undefined when nothing usable was declared", () => {
    expect(declaredIgnoreSelectors("nope")).toBeUndefined();
    expect(declaredIgnoreSelectors([1, 2])).toBeUndefined();
    expect(declaredIgnoreSelectors([])).toBeUndefined();
  });
});

describe("mergeParameters ignoreSelectors", () => {
  it("passes a refused selector through so the runner can report it", () => {
    const merged = mergeParameters({
      parameters: { storyshelf: { ignoreSelectors: [".a", "b{}"] } },
    });
    expect(merged?.ignoreSelectors).toEqual([".a", "b{}"]);
  });

  it("reads the chromatic key alone", () => {
    const merged = mergeParameters({ parameters: { chromatic: { ignoreSelectors: [".a"] } } });
    expect(merged?.ignoreSelectors).toEqual([".a"]);
  });

  it("lets storyshelf win over chromatic", () => {
    const merged = mergeParameters({
      parameters: {
        chromatic: { ignoreSelectors: [".a"] },
        storyshelf: { ignoreSelectors: [".b"] },
      },
    });
    expect(merged?.ignoreSelectors).toEqual([".b"]);
  });

  it("drops an invalid value instead of failing", () => {
    const merged = mergeParameters({
      parameters: { storyshelf: { ignoreSelectors: "nope" as unknown as string[], delay: 5 } },
    });
    expect(merged).toEqual({ delay: 5 });
  });
});
