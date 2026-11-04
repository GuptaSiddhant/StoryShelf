/** axe-core accessibility checks for captured pages (ADR 0004 §6). */

import {
  axeInjectionScript,
  axeUnavailableNote,
  inPageReadA11yParameters,
  inPageRunAxe,
  loadAxeSource,
  mapAxeViolations,
  parametersNote,
  resolveA11yRun,
  type A11yParametersRead,
} from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";
import type { Page } from "playwright-core";

/**
 * Run axe over the story root and return one annotation string per violation (worst first).
 * Honours `parameters.a11y` (`disable`, `test: "off"`, `config`, `options`, `element`/`context`;
 * function values cannot be read from the page and are dropped, with one warning). A parameter that
 * cannot be read as plain data (cyclic or too deep) runs axe with its defaults and puts one note,
 * `a11y parameters not serializable: <reason>`, first. Results are annotations: nothing
 * here fails a build. If axe cannot be loaded or injected the result is one visible annotation
 * (`axe unavailable: <reason>`) instead of a silent pass.
 */
export async function checkA11y(page: Page, logger?: Logger, storyId?: string): Promise<string[]> {
  try {
    const read = await page.evaluate(inPageReadA11yParameters);
    warnAboutParameters(read, logger, storyId);
    const plan = resolveA11yRun(read?.params);
    if (plan.skip) return [];
    // Source string over CDP `Runtime.evaluate`: not CSP-bound and works on remote browsers.
    await page.evaluate(axeInjectionScript(await loadAxeSource()));
    const findings = mapAxeViolations(await page.evaluate(inPageRunAxe, plan));
    return read?.unserializable === undefined
      ? findings
      : [parametersNote(read.unserializable), ...findings];
  } catch (error) {
    return [axeUnavailableNote(error instanceof Error ? error.message : String(error))];
  }
}

/** One warning for values the page could not hand over, one for a parameter that could not be read. */
function warnAboutParameters(
  read: A11yParametersRead | undefined,
  logger: Logger | undefined,
  storyId: string | undefined,
): void {
  if (read && read.dropped > 0)
    logger?.warn(
      { storyId, dropped: read.dropped },
      "parameters.a11y: function, symbol or undefined values were omitted; axe uses the remaining configuration",
    );
  if (read?.unserializable !== undefined)
    logger?.warn(
      { storyId, reason: read.unserializable },
      "parameters.a11y could not be read as plain data; axe runs with its defaults",
    );
}
