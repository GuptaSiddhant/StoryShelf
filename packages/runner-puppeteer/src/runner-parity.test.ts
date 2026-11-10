import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";

/**
 * AGENTS.md: the two runners keep their copies of the shared modules identical. This test reads
 * both copies and fails on any difference that is not listed below. A listed difference is a
 * Playwright snippet that must appear exactly once in the Playwright file and is replaced by its
 * Puppeteer counterpart before the two are compared, so a stale entry fails too.
 */
type Difference = { playwright: string; puppeteer: string; why: string };

const PAGE_TYPE: Difference = {
  playwright: 'import type { Page } from "playwright-core";',
  puppeteer: 'import type { Page } from "puppeteer-core";',
  why: "each runner types the page with its own engine",
};

const SERIALIZES = (engine: string): string => `${engine} serializes only this function's source`;

const SHARED: Record<string, Difference[]> = {
  "settle.ts": [
    PAGE_TYPE,
    {
      playwright: "await page.addInitScript(inPageRecorder);",
      puppeteer: "await page.evaluateOnNewDocument(inPageRecorder);",
      why: "the engines name the run-before-any-page-script hook differently",
    },
    {
      playwright: SERIALIZES("Playwright"),
      puppeteer: SERIALIZES("Puppeteer"),
      why: "the comment names its engine",
    },
  ],
  "play.ts": [
    PAGE_TYPE,
    {
      playwright: SERIALIZES("Playwright"),
      puppeteer: SERIALIZES("Puppeteer"),
      why: "the comment names its engine",
    },
  ],
  "a11y.ts": [PAGE_TYPE],
  "runtime-params.ts": [
    {
      playwright: `/** Read every story's resolved parameters from a loaded preview page in one call. */
export async function extractAllParameters(
  page: RuntimeParamsPage,
): Promise<Record<string, StoryParameters>> {
  const raw = await readExtractedParameters(page);
  const out = new Map<string, StoryParameters>();
  if (raw) fillParamsMap(out, raw);
  return Object.fromEntries(out);
}

`,
      puppeteer: "",
      why: "only the Playwright pipeline reads every story's parameters in one call; the Puppeteer pipeline reads them per story through runtimeParametersForStory",
    },
  ],
};

async function source(runner: string, file: string): Promise<string> {
  return await readFile(new URL(`../../${runner}/src/${file}`, import.meta.url), "utf8");
}

function applyDifferences(text: string, differences: Difference[], file: string): string {
  let result = text;
  for (const { playwright, puppeteer } of differences) {
    const parts = result.split(playwright);
    expect(parts.length - 1, `${file}: "${playwright.slice(0, 60)}" must appear once`).toBe(1);
    result = parts.join(puppeteer);
  }
  return result;
}

describe("the runners' shared modules", () => {
  it.each(Object.entries(SHARED))(
    "%s is identical apart from the listed differences",
    async (file, differences) => {
      const playwright = await source("runner-playwright", file);
      const puppeteer = await source("runner-puppeteer", file);
      expect(applyDifferences(playwright, differences, file)).toBe(puppeteer);
    },
  );

  it("lists a reason for every difference", () => {
    for (const differences of Object.values(SHARED)) {
      for (const { why } of differences) expect(why.length).toBeGreaterThan(10);
    }
  });
});
