/**
 * Renders a pass in slices that each fit one signed Storybook URL (ADR 0007, decision 5). A token
 * never lives longer than `MAX_STORYBOOK_URL_TTL` (and a project may set it lower), so a pass whose
 * budget outlasts that is cut into slices of stories and every slice asks the source for a fresh
 * token just before it starts: the render never dies when its token does. A pass that fits one
 * token (the usual case, and every target without a signed URL) is one render call, as before.
 */
import type { CaptureTarget, CaptureRunner, RenderResult } from "../adapters/capture-runner.ts";
import { PER_CAPTURE_BUDGET_MS, STORYBOOK_URL_TTL_GRACE } from "../utils/storybook-token.ts";
import type { StoryEntry } from "./adapter.ts";
import { renderBudgetMs, renderWithTimeout } from "./render.ts";
import type { RenderRequest } from "./render.ts";
import type { StorybookUrlSource } from "./storybook-urls.ts";

/** What cutting a pass into slices needs of its caller. */
export interface SliceInput {
  runner: CaptureRunner;
  /** The render call without its `storybookUrl`; its `stories` are the whole pass. */
  request: RenderRequest;
  browser: CaptureTarget;
  storybookUrl: StorybookUrlSource | undefined;
  /** Captures one story expands to (its viewports and modes). */
  captureCount: (story: StoryEntry) => number;
  /** An explicit budget limits each call; a signed URL may require a shorter timeout. */
  renderTimeoutMs: number | undefined;
}

/**
 * The project's signed URL lifetime cannot hold what the pass must capture (a configuration
 * problem): retrying or isolating stories cannot help, so the job fails once with this message.
 */
export class SignedUrlLifetimeError extends Error {
  override readonly name = "SignedUrlLifetimeError";
}

/** Render the pass, minting a fresh signed URL for each slice; results are concatenated. */
export async function renderInSlices(input: SliceInput): Promise<RenderResult> {
  const slices = slicesOf(input);
  const results: RenderResult[] = [];
  for (const slice of slices) {
    const requestedBudgetMs = renderBudgetMs(slice.expected, input.renderTimeoutMs);
    const ttl = input.storybookUrl?.ttlSeconds?.(input.browser, requestedBudgetMs);
    const budgetMs =
      ttl === undefined
        ? requestedBudgetMs
        : Math.min(requestedBudgetMs, (ttl - STORYBOOK_URL_TTL_GRACE) * 1000);
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
  if (ttl === undefined || budgetSeconds + STORYBOOK_URL_TTL_GRACE <= ttl) {
    return whole;
  }
  return cut(stories, counts, sliceLimit(ttl));
}

function sliceLimit(ttl: number): number {
  const limit = Math.floor(((ttl - STORYBOOK_URL_TTL_GRACE) * 1000) / PER_CAPTURE_BUDGET_MS);
  if (limit < 1) {
    throw new SignedUrlLifetimeError(
      "Signed Storybook URL lifetime is too short for one capture and its grace period; increase or clear the project lifetime override.",
    );
  }
  return limit;
}

function checkedCount(count: number, limit: number): number {
  if (count > limit) {
    throw new SignedUrlLifetimeError(
      `A story expands to ${count} captures, exceeding the signed URL slice limit of ${limit}; increase or clear the project lifetime override.`,
    );
  }
  return count;
}

function cut(stories: StoryEntry[], counts: number[], limit: number): Slice[] {
  const slices: Slice[] = [];
  let current: Slice = { stories: [], expected: 0 };
  for (const [index, story] of stories.entries()) {
    const count = checkedCount(counts[index] ?? 0, limit);
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
