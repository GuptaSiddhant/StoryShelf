/** axe-core accessibility checks for captured pages (ADR 0004 §6). */

import {
  axeInjectionScript,
  inPageReadA11yParameters,
  inPageRunAxe,
  loadAxeSource,
  mapAxeViolations,
  resolveA11yRun,
} from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";
import type { Page } from "playwright-core";

/**
 * Run axe over the story root and return one annotation string per violation (worst first).
 * Honours `parameters.a11y` (`disable`, `test: "off"`, `config`, `options`, `element`/`context`;
 * function values cannot be read from the page and are dropped, with one debug line). Results are annotations: nothing
 * here fails a build. If axe cannot be loaded or injected the result is one visible annotation
 * (`axe unavailable: <reason>`) instead of a silent pass.
 */
export async function checkA11y(page: Page, logger?: Logger): Promise<string[]> {
  try {
    const read = await page.evaluate(inPageReadA11yParameters);
    if (read && read.dropped > 0)
      logger?.debug({ dropped: read.dropped }, "parameters.a11y: function values left out");
    const plan = resolveA11yRun(read?.params);
    if (plan.skip) return [];
    // Source string over CDP `Runtime.evaluate`: not CSP-bound and works on remote browsers.
    await page.evaluate(axeInjectionScript(await loadAxeSource()));
    return mapAxeViolations(await page.evaluate(inPageRunAxe, plan));
  } catch (error) {
    return [`axe unavailable: ${error instanceof Error ? error.message : String(error)}`];
  }
}
