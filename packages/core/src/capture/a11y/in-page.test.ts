import { afterEach, describe, expect, it } from "vitest";
import { inPageReadA11yParameters } from "./in-page.ts";

type Fn = (...args: never[]) => unknown;

/**
 * Rebuild the function from its source in a scope that has no module bindings, the way
 * `page.evaluate` ships it to the browser. Any reference to a module-level helper then throws.
 */
function asSerialized<T extends Fn>(fn: T): T {
  // oxlint-disable-next-line typescript/no-implied-eval, eslint/no-new-func -- the point is to rebuild the function from source
  return new Function(`return (${fn.toString()})`)() as T;
}

const scope = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  delete scope["__STORYBOOK_PREVIEW__"];
});

const preview = (a11y: unknown): void => {
  scope["__STORYBOOK_PREVIEW__"] = { currentRender: { story: { parameters: { a11y } } } };
};

describe("inPageReadA11yParameters (as serialized)", () => {
  const read = asSerialized(inPageReadA11yParameters);

  it("returns plain data, dropping function values and items that held only one", () => {
    scope["__STORYBOOK_PREVIEW__"] = {
      currentRender: {
        story: {
          parameters: {
            a11y: {
              disable: false,
              fn: () => 1,
              config: { rules: [{ id: "x", matches: () => true }, { matches: () => true }, 3] },
            },
          },
        },
      },
    };
    expect(read()).toEqual({
      params: { disable: false, config: { rules: [{ id: "x" }, 3] } },
      dropped: 3,
    });
  });

  it("keeps empty objects and arrays the author wrote", () => {
    scope["__STORYBOOK_PREVIEW__"] = {
      currentRender: { story: { parameters: { a11y: { config: {}, options: { rules: [] } } } } },
    };
    expect(read()).toEqual({ params: { config: {}, options: { rules: [] } }, dropped: 0 });
  });

  it("reports a parameter that is only a function as dropped", () => {
    scope["__STORYBOOK_PREVIEW__"] = {
      currentRender: { story: { parameters: { a11y: () => 1 } } },
    };
    expect(read()).toEqual({ params: undefined, dropped: 1 });
  });

  it("returns undefined without a preview or without an a11y parameter", () => {
    expect(read()).toBeUndefined();
    scope["__STORYBOOK_PREVIEW__"] = { currentRender: { story: { parameters: {} } } };
    expect(read()).toBeUndefined();
  });

  it("turns a Date into its ISO string, a Set into an array and a Map into pairs", () => {
    preview({
      config: {
        when: new Date("2026-01-02T03:04:05.000Z"),
        tags: new Set(["wcag2a", "wcag2aa"]),
        rules: new Map([["color-contrast", { enabled: false }]]),
      },
    });
    expect(read()).toEqual({
      params: {
        config: {
          when: "2026-01-02T03:04:05.000Z",
          tags: ["wcag2a", "wcag2aa"],
          rules: [["color-contrast", { enabled: false }]],
        },
      },
      dropped: 0,
    });
  });

  it("drops an invalid Date and keeps a value shared twice without a cycle", () => {
    const shared = { enabled: false };
    preview({ bad: new Date("nope"), a: shared, b: shared });
    expect(read()).toEqual({ params: { a: shared, b: shared }, dropped: 1 });
  });

  it("names a cyclic value instead of looking like no a11y parameter", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    preview(cyclic);
    expect(read()).toEqual({
      params: undefined,
      dropped: 0,
      unserializable: "refers to itself (cyclic)",
    });
  });

  it("names a value nested too deep", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let level = 0; level < 40; level += 1) deep = { next: deep };
    preview(deep);
    expect(read()).toMatchObject({
      params: undefined,
      unserializable: "nested more than 32 levels deep",
    });
  });
});
