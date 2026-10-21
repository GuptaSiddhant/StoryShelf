/** axe-core accessibility checks for captured pages (ADR 0004 §6). */

import {
  axeInjectionScript,
  inPageReadA11yParameters,
  inPageRunAxe,
  loadAxeSource,
  mapAxeViolations,
  resolveA11yRun,
} from "@storyshelf/core/capture";
import type { Page } from "puppeteer-core";

/**
 * Run axe over the story root and return one annotation string per violation (worst first).
 * Honours `parameters.a11y` (`disable`, `test: "off"`, `config`, `options`, `element`/`context`;
 * only the JSON-serialisable subset can be read from the page). Results are annotations: nothing
 * here fails a build. If axe cannot be loaded or injected the result is one visible annotation
 * (`axe unavailable: <reason>`) instead of a silent pass.
 */
export async function checkA11y(page: Page): Promise<string[]> {
  try {
    const plan = resolveA11yRun(await page.evaluate(inPageReadA11yParameters));
    if (plan.skip) return [];
    // Source string over CDP `Runtime.evaluate`: not CSP-bound and works on remote browsers.
    await page.evaluate(axeInjectionScript(await loadAxeSource()));
    return mapAxeViolations(await page.evaluate(inPageRunAxe, plan));
  } catch (error) {
    return [`axe unavailable: ${error instanceof Error ? error.message : String(error)}`];
  }
}
