/**
 * Functions evaluated inside the story page. Playwright and Puppeteer serialise only a function's
 * source, so each must stay ONE self-contained function: no imports, helpers or module bindings
 * (`in-page.test.ts` rebuilds them from source in a bare scope to guard that).
 */

import type { SlimViolation } from "./map.ts";
import type { A11yRunPlan } from "./options.ts";

/** What {@link inPageReadA11yParameters} found: the plain-data `parameters.a11y` and what was dropped. */
export interface A11yParametersRead {
  params: unknown;
  /** Function, symbol and undefined values left out because a page cannot hand them over. */
  dropped: number;
}

/**
 * Read the current story's `parameters.a11y` from the running Storybook preview as plain data.
 * Functions (`config.rules[].matches`, custom checks) cannot cross into the runner, so they are
 * dropped, and an object or array item that held nothing else goes with them (an emptied rule item
 * would otherwise reset to axe's default). Returns undefined when there is no `a11y` parameter or it
 * cannot be read at all (cyclic).
 */
// oxlint-disable-next-line eslint/max-statements -- must stay one self-contained function (see above)
export function inPageReadA11yParameters(): A11yParametersRead | undefined {
  const win = globalThis as unknown as {
    // oxlint-disable-next-line eslint/no-underscore-dangle -- Storybook global
    __STORYBOOK_PREVIEW__?: {
      currentRender?: { story?: { parameters?: { a11y?: unknown } } };
    };
  };
  // oxlint-disable-next-line eslint/no-underscore-dangle -- Storybook global
  const a11y = win.__STORYBOOK_PREVIEW__?.currentRender?.story?.parameters?.a11y;
  if (a11y === undefined) return undefined;
  const state = { dropped: 0 };
  const DROP = Symbol("drop");
  const clean = (value: unknown, depth: number): unknown => {
    if (depth > 32) throw new Error("too deep");
    if (typeof value === "function" || typeof value === "symbol" || value === undefined) {
      state.dropped += 1;
      return DROP;
    }
    if (value === null || typeof value !== "object") return value;
    const before = state.dropped;
    const entries: [string, unknown][] = Array.isArray(value)
      ? value.map((item, index): [string, unknown] => [String(index), item])
      : Object.entries(value);
    const kept = entries
      .map(([key, item]): [string, unknown] => [key, clean(item, depth + 1)])
      .filter(([, item]) => item !== DROP);
    if (kept.length === 0 && entries.length > 0 && state.dropped > before) return DROP;
    return Array.isArray(value) ? kept.map(([, item]) => item) : Object.fromEntries(kept);
  };
  try {
    const params = clean(a11y, 0);
    return { params: params === DROP ? undefined : params, dropped: state.dropped };
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
