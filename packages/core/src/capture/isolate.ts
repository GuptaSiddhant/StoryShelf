/** Localizing a browser crash to the story that caused it, instead of failing every story with it. */
import type { RenderFailure, RenderedSnapshot } from "../adapters/capture-runner.ts";
import type { StoryEntry } from "./adapter.ts";

/**
 * Render one engine's stories, narrowing a crash down to the story that caused it.
 *
 * A render call that throws takes its whole slice with it, so the stories it had not reached yet are
 * re-rendered as two halves, and so on until a single story is left holding the crash. That story
 * gets one pass on its own (a fresh browser) before it is blamed: only a story that crashes alone is
 * failed, and its shard-mates still get captured. A crash that never yields a single screenshot is
 * treated as the environment being broken rather than any one story's fault, and rethrown for the
 * caller to fail the whole slice.
 *
 * A story counts as done only once every one of its viewports has a capture or a failure, so a
 * crash partway through a story's viewports renders it again rather than losing the rest.
 */
export async function renderIsolating(
  stories: readonly StoryEntry[],
  pass: (slice: StoryEntry[]) => Promise<PassOutcome>,
  options: IsolationOptions = {},
): Promise<IsolatedResult> {
  const { note } = options;
  const state = newState(stories.length, options.viewportsOf);
  const queue: StoryEntry[][] = stories.length > 0 ? [[...stories]] : [];
  while (queue.length > 0) {
    // oxlint-disable-next-line no-await-in-loop -- one browser at a time, like the render loop
    await step(state, queue, pass, note);
  }
  if (state.captures.length === 0 && state.crash !== undefined) {
    throw state.crash;
  }
  return result(state, stories.length);
}

/** Render the next slice on the queue and deal with however it ended. */
async function step(
  state: IsolationState,
  queue: StoryEntry[][],
  pass: (slice: StoryEntry[]) => Promise<PassOutcome>,
  note?: IsolationNote,
): Promise<void> {
  const slice = queue.shift() ?? [];
  const outcome = await pass(slice);
  absorb(state, outcome);
  if (outcome.error !== undefined) {
    split(state, slice, queue, note);
  }
  if (state.captures.length === 0 && state.passes >= state.blindBudget) {
    // Not one screenshot yet: read that as the environment being broken, not a story's doing.
    queue.length = 0;
    return;
  }
  if (state.passes >= MAX_PASSES) {
    failRest(state, queue, note);
  }
}

/** What one render pass produced, whether it ran to the end or crashed partway. */
export interface PassOutcome {
  /** Screenshots the pass took; on a crash, the ones it managed before dying. */
  captures: RenderedSnapshot[];
  failures: RenderFailure[];
  /** Set when the render call threw outright, instead of reporting per-story failures. */
  error?: unknown;
}

/** Everything the isolating loop produced for one engine. */
export interface IsolatedResult {
  captures: RenderedSnapshot[];
  failures: RenderFailure[];
  /** Stories this engine was asked to render (retries are not counted twice). */
  renderCount: number;
  /** Stories blamed for a crash and failed on their own. */
  poisoned: string[];
}

/** How {@link renderIsolating} reports and what it knows about the stories. */
export interface IsolationOptions {
  note?: IsolationNote | undefined;
  /**
   * Names of the viewports a story is rendered at (as resolved for the pass). Without it, a story
   * counts as done after its first capture or failure.
   */
  viewportsOf?: ((story: StoryEntry) => readonly string[]) | undefined;
}

/** Progress lines for the attempt log; the caller decides where they go. */
export type IsolationNote = (
  event: "isolating" | "poisoned" | "abandoned",
  fields: Record<string, unknown>,
) => void;

/**
 * Render passes one engine may spend narrowing crashes down before the stories still unrendered are
 * failed without another try. Localizing one crash costs about log2(stories) passes, so this leaves
 * room for a handful of bad stories without letting a shard of hundreds launch a browser per story.
 */
const MAX_PASSES = 48;

/** A crash covers every viewport of the story it is blamed on. */
const ALL_VIEWPORTS = "*";

interface IsolationState {
  captures: RenderedSnapshot[];
  failures: RenderFailure[];
  poisoned: string[];
  /** Stories with every viewport captured or failed, or blamed as a whole. */
  captured: Set<string>;
  /** `(story, viewport)` pairs captured or failed so far. */
  settled: Set<string>;
  viewportsOf: ((story: StoryEntry) => readonly string[]) | undefined;
  passes: number;
  /**
   * Crashing passes to allow before a slice that has produced nothing at all is given up on: enough
   * to halve the slice down to a single story and still see a healthy half render.
   */
  blindBudget: number;
  /** First crash seen, rethrown when not one story turned out to be at fault. */
  crash?: unknown;
}

function newState(total: number, viewportsOf: IsolationState["viewportsOf"]): IsolationState {
  return {
    captures: [],
    failures: [],
    poisoned: [],
    captured: new Set(),
    settled: new Set(),
    viewportsOf,
    passes: 0,
    blindBudget: Math.ceil(Math.log2(total + 1)) + 2,
  };
}

function result(state: IsolationState, renderCount: number): IsolatedResult {
  return {
    captures: state.captures,
    failures: state.failures,
    renderCount,
    poisoned: state.poisoned,
  };
}

/**
 * Take in what a pass produced, successful or not. A story rendered again after a crash yields its
 * already-settled viewports a second time; only the first of each is kept.
 */
function absorb(state: IsolationState, outcome: PassOutcome): void {
  state.passes += 1;
  for (const capture of outcome.captures) {
    if (settle(state, capture.story.id, capture.viewportName)) {
      state.captures.push(capture);
    }
  }
  for (const failure of outcome.failures) {
    if (settle(state, failure.storyId, failure.viewportName)) {
      state.failures.push(failure);
    }
  }
  if (outcome.error !== undefined) {
    state.crash ??= outcome.error;
  }
}

/** Record one `(story, viewport)` outcome; false when it was already in. */
function settle(state: IsolationState, storyId: string, viewportName: string): boolean {
  const key = `${storyId}\u0000${viewportName}`;
  if (state.settled.has(key) || state.captured.has(storyId)) {
    return false;
  }
  state.settled.add(key);
  return true;
}

/** Whether every viewport of the story has an outcome (or the story was failed as a whole). */
function isDone(state: IsolationState, story: StoryEntry): boolean {
  if (state.captured.has(story.id)) {
    return true;
  }
  const names = state.viewportsOf?.(story);
  const done = names
    ? names.every((name) => state.settled.has(`${story.id}\u0000${name}`))
    : [...state.settled].some((key) => key.startsWith(`${story.id}\u0000`));
  if (done) {
    state.captured.add(story.id);
  }
  return done;
}

/**
 * Narrow a crashed slice down: queue the halves of what it left unfinished for another try. The
 * last story left gets a pass on its own first, and is blamed only if it crashes there too.
 */
function split(
  state: IsolationState,
  slice: StoryEntry[],
  queue: StoryEntry[][],
  note?: IsolationNote,
): void {
  const rest = slice.filter((story) => !isDone(state, story));
  const [first] = rest;
  if (first === undefined) {
    return;
  }
  if (rest.length === 1 && slice.length === 1) {
    blame(state, first, note);
    return;
  }
  const half = Math.ceil(rest.length / 2);
  // Breadth first: the healthy half renders early, which is what tells a bad story apart from a
  // broken browser (see `blindBudget`).
  queue.push(...[rest.slice(0, half), rest.slice(half)].filter((part) => part.length > 0));
  note?.("isolating", { stories: rest.length });
}

/** Fail one story for the crash and stop rendering it. */
function blame(state: IsolationState, story: StoryEntry, note?: IsolationNote): void {
  state.captured.add(story.id);
  state.poisoned.push(story.id);
  state.failures.push({
    storyId: story.id,
    viewportName: ALL_VIEWPORTS,
    error: crashText(state.crash),
  });
  note?.("poisoned", { storyId: story.id });
}

/** Out of passes: fail what is left unrendered rather than keep launching browsers. */
function failRest(state: IsolationState, queue: StoryEntry[][], note?: IsolationNote): void {
  const rest = queue
    .flat()
    .filter((story) => !isDone(state, story))
    .map((story) => story.id);
  for (const storyId of new Set(rest)) {
    state.captured.add(storyId);
    state.failures.push({
      storyId,
      viewportName: ALL_VIEWPORTS,
      error: `not rendered: ${crashText(state.crash)}`,
    });
  }
  queue.length = 0;
  note?.("abandoned", { stories: rest.length, passes: state.passes });
}

function crashText(crash: unknown): string {
  const message = crash instanceof Error ? crash.message : String(crash);
  return `browser crashed: ${message}`;
}
