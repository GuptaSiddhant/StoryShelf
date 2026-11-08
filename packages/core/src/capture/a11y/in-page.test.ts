import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { loadAxeSource } from "./axe-source.ts";
import { inPageReadA11yParameters, inPageRunAxe } from "./in-page.ts";
import { resolveA11yRun } from "./options.ts";

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

async function run(html: string, params?: unknown) {
  const dom = new JSDOM(
    `<!doctype html><html lang="en"><head><title>t</title></head><body>${html}</body></html>`,
    {
      runScripts: "outside-only",
    },
  );
  dom.window.eval(await loadAxeSource());
  const fn = dom.window.eval(`(${inPageRunAxe.toString()})`) as typeof inPageRunAxe;
  // Evaluate against the jsdom window as the page global.
  const plan = resolveA11yRun(params);
  const holder = dom.window as unknown as { shelfRun: typeof inPageRunAxe };
  holder.shelfRun = fn;
  return await (
    dom.window.eval("(plan) => shelfRun.call(globalThis, plan)") as (
      p: unknown,
    ) => Promise<ReturnType<typeof inPageRunAxe>>
  )(plan);
}

describe("inPageRunAxe (as serialized, real axe in jsdom)", () => {
  it("reports image-alt and button-name with slim fields", async () => {
    const out = await run('<div id="storybook-root"><img src="x.png"><button></button></div>', {
      options: { runOnly: ["image-alt", "button-name"] },
    });
    expect(out.map((x) => x.id)).toEqual(expect.arrayContaining(["button-name", "image-alt"]));
    expect(out.find((x) => x.id === "image-alt")).toMatchObject({
      count: 1,
      target: "img",
      impact: "critical",
    });
    expect(Object.keys(out[0] ?? {})).toHaveLength(5);
  });

  it("is clean for an accessible story", async () => {
    const out = await run(
      '<div id="storybook-root"><img src="x.png" alt="logo"><button>Go</button></div>',
      {
        options: { runOnly: ["image-alt", "button-name"] },
      },
    );
    expect(out).toEqual([]);
  });

  it("honours config.rules and ignores markup outside the story root", async () => {
    const html = '<img src="outside.png"><div id="storybook-root"><img src="x.png"></div>';
    expect((await run(html, { options: { runOnly: ["image-alt"] } })).map((x) => x.count)).toEqual([
      1,
    ]);
    // Default tag-based runOnly: a rule disabled through config is excluded (explicit rule ids would override it).
    expect((await run(html)).map((x) => x.id)).toEqual(["image-alt"]);
    const off = await run(html, {
      config: { rules: [{ id: "image-alt", enabled: false }] },
    });
    expect(off).toEqual([]);
  });

  it("runs best-practice rules by default and not the page-level ones for the story root", async () => {
    const html =
      '<div id="storybook-root"><h1>Title</h1><h4>Skipped levels</h4><p>Text outside any landmark</p></div>';
    const ids = (await run(html)).map((x) => x.id);
    expect(ids).toContain("heading-order");
    // `region`, `landmark-one-main` and `page-has-heading-one` need the whole page in scope.
    expect(ids).not.toContain("region");
    expect(ids).not.toContain("landmark-one-main");
    // An explicit runOnly replaces the default set, best-practice rules included.
    expect(await run(html, { options: { runOnly: ["image-alt"] } })).toEqual([]);
  });

  it("reports the page-level rules when an explicit whole-document context is given", async () => {
    const html =
      '<div id="storybook-root"><h4>Skipped levels</h4><p>Text outside any landmark</p></div>';
    // `context: "html"` puts the whole document in scope, so a page-level rule can fire (`region`
    // here; `landmark-one-main` and `page-has-heading-one` need a real browser's document, not jsdom).
    const ids = (await run(html, { context: "html" })).map((x) => x.id);
    expect(ids).toContain("region");
    // The default scan of the story root stays silent on them.
    const rootIds = (await run(html)).map((x) => x.id);
    expect(rootIds).not.toContain("region");
  });

  it("returns nothing when the context element is missing", async () => {
    expect(await run("<p>no root</p>")).toEqual([]);
  });

  it("throws when axe is not loaded", async () => {
    const dom = new JSDOM("<!doctype html>", { runScripts: "outside-only" });
    const fn = dom.window.eval(`(${inPageRunAxe.toString()})`) as (p: unknown) => Promise<unknown>;
    await expect(fn.call(dom.window, resolveA11yRun(null))).rejects.toThrow("axe is not loaded");
  });
});
