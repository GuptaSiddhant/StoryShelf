/** Per-run runtime-parameter extraction cache (ADR 0017). */

import { mergeParameters } from "@storyshelf/core/capture";
import type { StoryParameters } from "@storyshelf/core/capture";
import type { ExtractedEntry, RuntimeParamsPage, RuntimeParamsState } from "./types.ts";

/** Create the per-run runtime-parameter cache shared across captures. */
export function createRuntimeParamsState(): RuntimeParamsState {
  return {};
}

/**
 * Read story parameters from the running preview via
 * `__STORYBOOK_PREVIEW__.extract()`, once per run and lazily.
 */
export async function runtimeParametersForStory(
  state: RuntimeParamsState,
  page: RuntimeParamsPage,
  storyId: string,
): Promise<StoryParameters | undefined> {
  const map = state.extractFailed ? undefined : await extractedParametersMap(state, page);
  return map?.get(storyId);
}

async function extractedParametersMap(
  state: RuntimeParamsState,
  page: RuntimeParamsPage,
): Promise<Map<string, StoryParameters>> {
  state.extractPromise ??= loadExtractedParametersMap(state, page);
  return await state.extractPromise;
}

async function loadExtractedParametersMap(
  state: RuntimeParamsState,
  page: RuntimeParamsPage,
): Promise<Map<string, StoryParameters>> {
  const raw = await safeReadExtracted(state, page);
  return buildParamsMap(state, raw);
}

async function safeReadExtracted(
  state: RuntimeParamsState,
  page: RuntimeParamsPage,
): Promise<Record<string, ExtractedEntry> | null> {
  try {
    return await readExtractedParameters(page);
  } catch {
    state.extractFailed = true;
    return null;
  }
}

function buildParamsMap(
  state: RuntimeParamsState,
  raw: Record<string, ExtractedEntry> | null,
): Map<string, StoryParameters> {
  const out = new Map<string, StoryParameters>();
  if (raw) fillParamsMap(out, raw);
  if (out.size === 0) state.extractFailed = true;
  return out;
}

function fillParamsMap(
  out: Map<string, StoryParameters>,
  raw: Record<string, ExtractedEntry>,
): void {
  for (const [id, entry] of Object.entries(raw)) {
    const merged = mergeParameters(entry);
    if (merged) out.set(id, merged);
  }
}

async function readExtractedParameters(
  page: RuntimeParamsPage,
): Promise<Record<string, ExtractedEntry> | null> {
  const map = (await page.evaluate(() => {
    const win = globalThis as unknown as {
      __STORYBOOK_PREVIEW__?: { extract?: () => unknown };
    };
    // oxlint-disable-next-line typescript/dot-notation -- __STORYBOOK_PREVIEW__ is a Storybook global
    const preview = win["__STORYBOOK_PREVIEW__"];
    if (!preview || typeof preview.extract !== "function") return null;
    const extracted = preview.extract();
    return extracted && typeof extracted === "object"
      ? (extracted as Record<string, ExtractedEntry>)
      : null;
  })) as Record<string, ExtractedEntry> | null;
  return hasEntries(map) ? map : null;
}

function hasEntries(map: Record<string, ExtractedEntry> | null): boolean {
  return Boolean(map && Object.keys(map).length > 0);
}
