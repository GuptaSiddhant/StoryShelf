/** Accessibility checks for captured pages. */

import type { Page } from "puppeteer-core";

/** Run lightweight a11y checks inside the page context. */
export async function checkA11y(page: Page): Promise<string[]> {
  return await evaluateA11y(page);
}

async function evaluateA11y(page: Page): Promise<string[]> {
  const raw: unknown = await page.evaluate(() => collectViolations());
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- narrowing unknown to string[]
  return raw as string[];
}

function collectViolations(): string[] {
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- document global narrowing
  const doc = globalThis.document as unknown as Document;
  const violations: string[] = [];
  const root = doc.querySelector("#storybook-root");
  if (!root) return violations;
  pushImageViolations(root, violations);
  pushButtonViolations(root, violations);
  pushLinkViolations(root, violations);
  pushInputViolations(root, doc, violations);
  return violations.slice(0, 10);
}

function pushImageViolations(root: Element, out: string[]): void {
  for (const img of root.querySelectorAll("img:not([alt])")) {
    out.push(`img missing alt: ${img.outerHTML.slice(0, 120)}`);
  }
}

function pushButtonViolations(root: Element, out: string[]): void {
  for (const btn of root.querySelectorAll("button")) {
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- narrow to HTMLButtonElement
    const hasLabel = hasButtonLabel(btn as unknown as HTMLButtonElement);
    if (!hasLabel) out.push(`button missing label: ${btn.outerHTML.slice(0, 120)}`);
  }
}

function hasButtonLabel(btn: HTMLButtonElement): boolean {
  return (
    btn.hasAttribute("aria-label") ||
    btn.hasAttribute("aria-labelledby") ||
    (btn.textContent ?? "").trim() !== ""
  );
}

function pushLinkViolations(root: Element, out: string[]): void {
  for (const anchor of root.querySelectorAll("a")) {
    if (!anchor.hasAttribute("href")) {
      out.push(`a missing href: ${anchor.outerHTML.slice(0, 120)}`);
    }
  }
}

function pushInputViolations(root: Element, doc: Document, out: string[]): void {
  for (const input of root.querySelectorAll("input, select, textarea")) {
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- narrow to HTMLInputElement
    const el = input as unknown as HTMLInputElement;
    if (needsInputLabel(el, doc)) out.push(`input missing label: ${el.outerHTML.slice(0, 120)}`);
  }
}

function needsInputLabel(el: HTMLInputElement, doc: Document): boolean {
  if (el.type === "hidden") return false;
  const hasLabel =
    el.hasAttribute("aria-label") ||
    el.hasAttribute("aria-labelledby") ||
    Boolean(doc.querySelector(`label[for="${el.id}"]`)) ||
    el.id === "";
  return !hasLabel;
}
