import { afterEach, describe, expect, it, vi } from "vitest";
import { checkA11y, inPageA11y } from "./a11y.ts";

type A11yFn = typeof inPageA11y;

/**
 * Rebuild the function from its source in a scope that has no module bindings, the way
 * `page.evaluate` ships it to the browser. Any reference to a module-level helper then throws.
 */
function asSerialized(fn: A11yFn): A11yFn {
  // oxlint-disable-next-line typescript/no-implied-eval, eslint/no-new-func -- the point is to rebuild the function from source
  return new Function(`return (${fn.toString()})`)() as A11yFn;
}

interface FakeEl {
  outerHTML: string;
  textContent?: string;
  type?: string;
  id?: string;
  hasAttribute: (name: string) => boolean;
}

function el(outerHTML: string, init: Partial<FakeEl> & { attrs?: string[] } = {}): FakeEl {
  const { attrs = [], ...rest } = init;
  return { outerHTML, id: "", ...rest, hasAttribute: (name) => attrs.includes(name) };
}

function installDom(selectors: Record<string, FakeEl[]>, labelFor: string[] = []): void {
  const root = { querySelectorAll: (sel: string) => selectors[sel] ?? [] };
  (globalThis as unknown as Record<string, unknown>)["document"] = {
    querySelector: (sel: string) => {
      if (sel === "#storybook-root") return root;
      const m = /^label\[for="(.*)"\]$/u.exec(sel);
      return m && labelFor.includes(m[1] ?? "") ? {} : null;
    },
  };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)["document"];
});

describe("inPageA11y (as serialized into the page)", () => {
  const run = asSerialized(inPageA11y);

  it("returns nothing when there is no storybook root", () => {
    (globalThis as unknown as Record<string, unknown>)["document"] = { querySelector: () => null };
    expect(run()).toEqual([]);
  });

  it("is self-contained and reports every violation kind", () => {
    installDom({
      "img:not([alt])": [el("<img src=x>")],
      button: [el("<button></button>", { textContent: " " })],
      a: [el("<a>x</a>")],
      "input, select, textarea": [el("<input id=q>", { id: "q", type: "text" })],
    });
    expect(run()).toEqual([
      "img missing alt: <img src=x>",
      "button missing label: <button></button>",
      "a missing href: <a>x</a>",
      "input missing label: <input id=q>",
    ]);
  });

  it("accepts labelled elements", () => {
    installDom(
      {
        button: [
          el("<b1>", { textContent: "Go" }),
          el("<b2>", { attrs: ["aria-label"] }),
          el("<b3>", { attrs: ["aria-labelledby"] }),
        ],
        a: [el("<a href>", { attrs: ["href"] })],
        "input, select, textarea": [
          el("<i1>", { id: "a", type: "text", attrs: ["aria-label"] }),
          el("<i2>", { id: "b", type: "text" }),
          el("<i3>", { id: "c", type: "hidden" }),
          el("<i4>", { id: "", type: "text" }),
        ],
      },
      ["b"],
    );
    expect(run()).toEqual([]);
  });

  it("caps the result at ten violations", () => {
    installDom({ "img:not([alt])": Array.from({ length: 15 }, () => el("<img>")) });
    expect(run()).toHaveLength(10);
  });
});

describe("checkA11y", () => {
  it("evaluates the self-contained function in the page", async () => {
    const evaluate = vi.fn().mockResolvedValue(["x"]);
    await expect(checkA11y({ evaluate } as never)).resolves.toEqual(["x"]);
    expect(evaluate).toHaveBeenCalledWith(inPageA11y);
  });
});
