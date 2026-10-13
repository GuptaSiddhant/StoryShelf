/** Which engines a project captures with, and the guards around that list. */
import { BROWSER_NAMES, DEFAULT_BROWSER, type BrowserName } from "../adapters/capture-runner.ts";

/** Upper bound on engines per project (each multiplies render time). */
export const MAX_BROWSERS = 3;

/** Parse the project's JSON `browsers` column; `null` when unset or malformed. */
export function parseBrowsers(raw: string | null | undefined): BrowserName[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((entry) => isBrowserName(entry))
      ? dedupe(parsed)
      : null;
  } catch {
    return null;
  }
}

/**
 * Engines to capture, primary first: the project's `browsers` list, else its
 * single legacy `browser`. Throws when the list exceeds {@link MAX_BROWSERS}.
 */
export function resolveBrowsers(project: {
  browser?: string | undefined;
  browsers?: string | null | undefined;
}): BrowserName[] {
  const listed = parseBrowsers(project.browsers);
  const single = isBrowserName(project.browser) ? project.browser : DEFAULT_BROWSER;
  const browsers = listed && listed.length > 0 ? listed : [single];
  assertBrowserCount(browsers);
  return browsers;
}

/** Throw when more than {@link MAX_BROWSERS} engines are requested. */
export function assertBrowserCount(browsers: readonly string[]): void {
  if (browsers.length > MAX_BROWSERS) {
    throw new Error(`At most ${MAX_BROWSERS} browsers are supported (got ${browsers.length})`);
  }
}

/** Throw when the runner declares engines and the project asks for others. */
export function assertSupportedBrowsers(
  browsers: readonly BrowserName[],
  supported?: readonly BrowserName[],
): void {
  const missing = supported ? browsers.filter((browser) => !supported.includes(browser)) : [];
  if (missing.length > 0) {
    throw new Error(`Capture runner does not support browser(s): ${missing.join(", ")}`);
  }
}

function isBrowserName(value: unknown): value is BrowserName {
  return typeof value === "string" && (BROWSER_NAMES as readonly string[]).includes(value);
}

function dedupe(browsers: BrowserName[]): BrowserName[] {
  return [...new Set(browsers)];
}
