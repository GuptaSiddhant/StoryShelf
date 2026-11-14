/** Grouping a render's captures into story-switching sessions (ADR 0052, decisions 1 and 4). */
import type { SwitchStoriesRequest } from "../adapters/capture-runner.ts";
import type { StoryEntry, Viewport } from "./adapter.ts";

/** Most stories one loaded page renders before it is reloaded (ADR 0052, decision 4). */
export const MAX_SESSION_STORIES = 25;

/** One capture: a story at a viewport. */
export interface SessionJob {
  story: StoryEntry;
  viewport: Viewport;
}

/**
 * Captures that share one loaded page. The first job is a fresh load, exactly as without
 * switching; every later job is reached by switching stories inside that page.
 */
export interface SwitchSession {
  jobs: SessionJob[];
}

/** What {@link planSwitchSessions} needs besides the jobs. */
export interface SessionPlanOptions {
  /** The runner's `switchStories` request; absent, every job is a session of its own. */
  request?: SwitchStoriesRequest | undefined;
  /** Whether play functions run (`executePlay`). */
  executePlay?: boolean | undefined;
  /** Pages the runner renders at once: work is split so that many sessions can run side by side. */
  lanes?: number | undefined;
  /** Session length cap; {@link MAX_SESSION_STORIES} when unset. */
  maxStories?: number | undefined;
}

/**
 * Group jobs into sessions, keeping their order. A job joins a session only when it may be
 * switched to: it has a baseline, its story runs no play function and does not ask for isolation
 * or paused animations, and it shares the session's viewport and globals. Every other job is a
 * session of its own (a fresh load). Without a request nothing is grouped.
 */
export function planSwitchSessions(
  jobs: readonly SessionJob[],
  options: SessionPlanOptions,
): SwitchSession[] {
  if (!switchingAllowed(jobs, options)) return jobs.map((job) => ({ jobs: [job] }));
  const baselined = baselinedKeys(options.request);
  const { alone, groups } = groupJobs(jobs);
  return [
    ...alone.map((job) => ({ jobs: [job] })),
    ...[...groups.values()].flatMap((group) =>
      chainsOf(group, baselined, chainLength(group.length, options)),
    ),
  ];
}

/** Split jobs into those that must load alone and groups that may share a page, in order. */
function groupJobs(jobs: readonly SessionJob[]): {
  alone: SessionJob[];
  groups: Map<string, SessionJob[]>;
} {
  const alone: SessionJob[] = [];
  const groups = new Map<string, SessionJob[]>();
  for (const job of jobs) {
    if (isClean(job)) {
      const key = sessionKey(job.viewport);
      groups.set(key, [...(groups.get(key) ?? []), job]);
    } else {
      alone.push(job);
    }
  }
  return { alone, groups };
}

/**
 * Whether this build may switch at all: a request was made, and play functions are either off or
 * declared through the index's `play-fn` tag (with no tag to go by, any story may run one).
 */
function switchingAllowed(jobs: readonly SessionJob[], options: SessionPlanOptions): boolean {
  if (!options.request) return false;
  if (!options.executePlay) return true;
  return jobs.some(({ story }) => story.tags?.includes("play-fn") === true);
}

/** A job that leaves nothing it is known to change behind: it may lead or join a session. */
function isClean({ story }: SessionJob): boolean {
  if (story.type !== "story" || story.parentId !== undefined) return false;
  // Storybook runs a story's play function on every render, whether or not StoryShelf asks it to.
  if (story.tags?.includes("play-fn") === true) return false;
  const parameters = story.parameters;
  return parameters?.isolate !== true && parameters?.pauseAnimationAtEnd !== true;
}

/** Captures that may share a page: the same size and the same globals (a mode is its own session). */
function sessionKey(viewport: Viewport): string {
  return JSON.stringify([viewport.width, viewport.height, viewport.globals ?? null]);
}

function pairKey(storyId: string, viewportName: string): string {
  return JSON.stringify([storyId, viewportName]);
}

function baselinedKeys(request: SwitchStoriesRequest | undefined): Set<string> {
  return new Set(
    (request?.baselined ?? []).map(({ storyId, viewportName }) => pairKey(storyId, viewportName)),
  );
}

/** Long enough to fill every lane, never longer than the cap. */
function chainLength(count: number, options: SessionPlanOptions): number {
  const cap = Math.max(1, options.maxStories ?? MAX_SESSION_STORIES);
  const lanes = Math.max(1, options.lanes ?? 1);
  return Math.max(1, Math.min(cap, Math.ceil(count / lanes)));
}

/**
 * Cut one group into sessions of at most `length` jobs. A job with no baseline is never switched
 * to (its capture could not be confirmed), so it starts a session of its own, as a fresh load.
 */
function chainsOf(
  group: readonly SessionJob[],
  baselined: ReadonlySet<string>,
  length: number,
): SwitchSession[] {
  const sessions: SwitchSession[] = [];
  let current: SessionJob[] = [];
  for (const job of group) {
    const switchable = baselined.has(pairKey(job.story.id, job.viewport.name));
    if (current.length === 0 || current.length >= length || !switchable) {
      current = [job];
      sessions.push({ jobs: current });
    } else {
      current.push(job);
    }
  }
  return sessions;
}
