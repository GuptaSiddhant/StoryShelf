/**
 * Functions evaluated inside the story page. Playwright and Puppeteer serialise only a function's
 * source, so each must stay ONE self-contained function: no imports, helpers or module bindings
 * (`in-page.test.ts` rebuilds them from source in a bare scope to guard that).
 */

import type { SlimViolation } from "./map.ts";
import type { A11yRunPlan } from "./options.ts";

/**
 * Read the current story's `parameters.a11y` from the running Storybook preview. Only the
 * JSON-serialisable subset survives (functions are dropped). Returns undefined when unreadable.
 */
export function inPageReadA11yParameters(): unknown {
  const win = globalThis as unknown as {
    // oxlint-disable-next-line eslint/no-underscore-dangle -- Storybook global
    __STORYBOOK_PREVIEW__?: {
      currentRender?: { story?: { parameters?: { a11y?: unknown } } };
    };
  };
  // oxlint-disable-next-line eslint/no-underscore-dangle -- Storybook global
  const a11y = win.__STORYBOOK_PREVIEW__?.currentRender?.story?.parameters?.a11y;
  if (a11y === undefined) return undefined;
  try {
    // oxlint-disable-next-line unicorn/prefer-structured-clone -- JSON drops functions; structuredClone throws on them
    return JSON.parse(JSON.stringify(a11y)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Run the injected axe over the plan's context and return only slim fields (id, impact, help, first
 * target, node count). Throws when axe is not present in the page.
 */
// oxlint-disable-next-line eslint/max-statements, eslint/max-lines-per-function -- must stay one self-contained function (see above)
export async function inPageRunAxe(plan: A11yRunPlan): Promise<SlimViolation[]> {
  const win = globalThis as unknown as {
    axe?: {
      configure: (config: unknown) => void;
      run: (context: unknown, options: unknown) => Promise<{ violations: AxeViolation[] }>;
    };
    document: { querySelector: (selector: string) => unknown };
  };
  interface AxeViolation {
    id: string;
    impact?: string | null;
    help: string;
    nodes: { target: unknown[] }[];
  }
  if (!win.axe) throw new Error("axe is not loaded in the page");
  if (typeof plan.context === "string" && !win.document.querySelector(plan.context)) return [];
  if (Object.keys(plan.config).length > 0) win.axe.configure(plan.config);
  const results = await win.axe.run(plan.context, plan.options);
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? null,
    help: v.help,
    target: (v.nodes[0]?.target ?? []).flat(Infinity).join(" "),
    count: v.nodes.length,
  }));
}
