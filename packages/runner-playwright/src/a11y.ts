/** Accessibility checks for captured pages. */

import type { Page } from "playwright-core";

/** Run lightweight a11y checks inside the page context. */
export async function checkA11y(page: Page): Promise<string[]> {
  return await page.evaluate(inPageA11y);
}

/**
 * Runs inside the browser. Playwright/Puppeteer serialize only this function's source, so it must
 * not reference anything from this module (helpers, imports): split it up and the page throws
 * `ReferenceError`. `a11y.test.ts` evaluates it in a scope without module bindings to guard that.
 */
// oxlint-disable-next-line eslint/max-statements, eslint/max-lines-per-function, eslint/complexity -- must stay one self-contained function (see above)
export function inPageA11y(): string[] {
  const doc = globalThis.document;
  const violations: string[] = [];
  const root = doc?.querySelector("#storybook-root");
  if (!root) return violations;
  for (const img of root.querySelectorAll("img:not([alt])")) {
    violations.push(`img missing alt: ${img.outerHTML.slice(0, 120)}`);
  }
  for (const btn of root.querySelectorAll("button")) {
    const labelled =
      btn.hasAttribute("aria-label") ||
      btn.hasAttribute("aria-labelledby") ||
      (btn.textContent ?? "").trim() !== "";
    if (!labelled) violations.push(`button missing label: ${btn.outerHTML.slice(0, 120)}`);
  }
  for (const anchor of root.querySelectorAll("a")) {
    if (!anchor.hasAttribute("href"))
      violations.push(`a missing href: ${anchor.outerHTML.slice(0, 120)}`);
  }
  for (const input of root.querySelectorAll("input, select, textarea")) {
    const el = input as HTMLInputElement;
    const labelled =
      el.type === "hidden" ||
      el.hasAttribute("aria-label") ||
      el.hasAttribute("aria-labelledby") ||
      el.id === "" ||
      Boolean(doc.querySelector(`label[for="${el.id}"]`));
    if (!labelled) violations.push(`input missing label: ${el.outerHTML.slice(0, 120)}`);
  }
  return violations.slice(0, 10);
}
