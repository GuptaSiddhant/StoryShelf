/** Checks a `story-status` answer before the addon trusts it. */
import {
  BUILD_STATUSES,
  DESIGN_PROBLEMS,
  SNAPSHOT_STATUSES,
  type StoryStatusBody,
  type StoryStatusEntry,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function entryOf(value: unknown): StoryStatusEntry | null {
  if (!isRecord(value) || !oneOf(SNAPSHOT_STATUSES, value["status"])) return null;
  const design = value["design"];
  if (design === undefined) return { status: value["status"] };
  return oneOf(DESIGN_PROBLEMS, design) ? { status: value["status"], design } : null;
}

/** The typed body, or null when the answer is not the shape the server documents. */
export function parseStoryStatus(value: unknown): StoryStatusBody | null {
  if (!isRecord(value) || !isRecord(value["build"]) || !isRecord(value["stories"])) return null;
  const { status, reviewPath } = value["build"];
  if (!oneOf(BUILD_STATUSES, status) || typeof reviewPath !== "string") return null;
  const stories = new Map<string, StoryStatusEntry>();
  for (const [id, raw] of Object.entries(value["stories"])) {
    const entry = entryOf(raw);
    if (!entry) return null;
    stories.set(id, entry);
  }
  return { build: { status, reviewPath }, stories: Object.fromEntries(stories) };
}
