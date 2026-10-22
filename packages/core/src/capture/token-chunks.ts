/**
 * Renders a pass in slices that each fit one signed Storybook URL (ADR 0007, decision 5). A token
 * never lives longer than `MAX_STORYBOOK_URL_TTL` (and a project may set it lower), so a pass whose
 * budget outlasts that is cut into slices of stories and every slice asks the source for a fresh
 * token just before it starts: the render never dies when its token does. A pass that fits one
 * token (the usual case, and every target without a signed URL) is one render call, as before.
 */
import type { CaptureTarget, CaptureRunner, RenderResult } from "../adapters/capture-runner.ts";
import { STORYBOOK_URL_TTL_GRACE } from "../utils/storybook-token.ts";
import type { StoryEntry } from "./adapter.ts";
import { PER_CAPTURE_BUDGET_MS, renderBudgetMs, renderWithTimeout } from "./render.ts";
import type { RenderRequest } from "./render.ts";
import type { StorybookUrlSource } from "./storybook-urls.ts";

/** Smallest slice (captures), so a very short project override never renders a page per call. */
export const MIN_CAPTURES_PER_SLICE = 50;

/** What cutting a pass into slices needs of its caller. */
export interface SliceInput {
  runner: CaptureRunner;
  /** The render call without its `storybookUrl`; its `stories` are the whole pass. */
  request: RenderRequest;
  browser: CaptureTarget;
  storybookUrl: StorybookUrlSource | undefined;
  /** Captures one story expands to (its viewports and modes). */
  captureCount: (story: StoryEntry) => number;
  /** An explicit budget fixes one call's timeout; slices then are not budgeted separately. */
  renderTimeoutMs: number | undefined;
}

/** Render the pass, minting a fresh signed URL for each slice; results are concatenated. */
export async function renderInSlices(input: SliceInput): Promise<RenderResult> {
  const slices = slicesOf(input);
  const results: RenderResult[] = [];
  for (const slice of slices) {
    const budgetMs = renderBudgetMs(slice.expected, input.renderTimeoutMs);
    // oxlint-disable-next-line no-await-in-loop -- each slice needs a token minted just before it
    const storybookUrl = await input.storybookUrl?.(input.browser, { budgetMs });
    results.push(
      // oxlint-disable-next-line no-await-in-loop -- slices render one after another
      await renderWithTimeout(
        input.runner,
        {
          ...input.request,
          stories: slice.stories,
          ...(storybookUrl === undefined ? {} : { storybookUrl }),
        },
        budgetMs,
      ),
    );
  }
  return mergeResults(results);
}

interface Slice {
  stories: StoryEntry[];
  expected: number;
}

/** One slice with every story, unless the pass outlasts the lifetime a token can have. */
function slicesOf(input: SliceInput): Slice[] {
  const { stories } = input.request;
  const counts = stories.map((story) => input.captureCount(story));
  const expected = counts.reduce((sum, count) => sum + count, 0);
  const whole: Slice[] = [{ stories, expected }];
  const ttl = input.storybookUrl?.ttlSeconds?.(
    input.browser,
    renderBudgetMs(expected, input.renderTimeoutMs),
  );
  const budgetSeconds = renderBudgetMs(expected, input.renderTimeoutMs) / 1000;
  if (
    ttl === undefined ||
    input.renderTimeoutMs !== undefined ||
    budgetSeconds + STORYBOOK_URL_TTL_GRACE <= ttl
  ) {
    return whole;
  }
  const limit = Math.max(
    MIN_CAPTURES_PER_SLICE,
    Math.floor(((ttl - STORYBOOK_URL_TTL_GRACE) * 1000) / PER_CAPTURE_BUDGET_MS),
  );
  return cut(stories, counts, limit);
}

function cut(stories: StoryEntry[], counts: number[], limit: number): Slice[] {
  const slices: Slice[] = [];
  let current: Slice = { stories: [], expected: 0 };
  for (const [index, story] of stories.entries()) {
    const count = counts[index] ?? 0;
    if (current.stories.length > 0 && current.expected + count > limit) {
      slices.push(current);
      current = { stories: [], expected: 0 };
    }
    current.stories.push(story);
    current.expected += count;
  }
  return [...slices, current];
}

function mergeResults(results: RenderResult[]): RenderResult {
  const [only] = results;
  if (results.length === 1 && only) {
    return only;
  }
  const environment = results.find((result) => result.environment)?.environment;
  return {
    captures: results.flatMap((result) => tagged(result)),
    failures: results.flatMap((result) => result.failures),
    ...(environment ? { environment } : {}),
  };
}

/** A slice's captures with the environment that slice reported (a reconnect may differ). */
function tagged(result: RenderResult): RenderResult["captures"] {
  for (const capture of result.captures) {
    if (result.environment) {
      capture.environment ??= result.environment;
    }
  }
  return result.captures;
}
