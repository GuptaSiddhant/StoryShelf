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

describe("inPageReadA11yParameters (as serialized)", () => {
  const read = asSerialized(inPageReadA11yParameters);

  it("returns the JSON-serialisable subset of the current story's parameters.a11y", () => {
    scope["__STORYBOOK_PREVIEW__"] = {
      currentRender: {
        story: {
          parameters: { a11y: { disable: false, config: { rules: [{ id: "x" }] }, fn: () => 1 } },
        },
      },
    };
    expect(read()).toEqual({ disable: false, config: { rules: [{ id: "x" }] } });
  });

  it("returns undefined without a preview, without a11y, or when unserialisable", () => {
    expect(read()).toBeUndefined();
    scope["__STORYBOOK_PREVIEW__"] = { currentRender: { story: { parameters: {} } } };
    expect(read()).toBeUndefined();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    scope["__STORYBOOK_PREVIEW__"] = { currentRender: { story: { parameters: { a11y: cyclic } } } };
    expect(read()).toBeUndefined();
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

  it("returns nothing when the context element is missing", async () => {
    expect(await run("<p>no root</p>")).toEqual([]);
  });

  it("throws when axe is not loaded", async () => {
    const dom = new JSDOM("<!doctype html>", { runScripts: "outside-only" });
    const fn = dom.window.eval(`(${inPageRunAxe.toString()})`) as (p: unknown) => Promise<unknown>;
    await expect(fn.call(dom.window, resolveA11yRun(null))).rejects.toThrow("axe is not loaded");
  });
});
