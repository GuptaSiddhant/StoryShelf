import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { loadAxeSource } from "./a11y-source.ts";
import { inPageRunAxe } from "./in-page.ts";
import { resolveA11yRun } from "./options.ts";

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
