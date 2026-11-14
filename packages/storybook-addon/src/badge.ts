/** What a sidebar badge says for a story's state; pure, so the labels are tested without a browser. */
import type { SnapshotStatus, StoryStatusEntry } from "./types.ts";

/** Visual weight of a badge. */
export type Tone = "neutral" | "good" | "warn" | "bad";

/** One badge: its text and tone. */
export interface Badge {
  label: string;
  tone: Tone;
}

const STATUS_BADGES: Readonly<Record<SnapshotStatus, Badge>> = {
  unchanged: { label: "Unchanged", tone: "neutral" },
  approved: { label: "Approved", tone: "good" },
  pending: { label: "Pending review", tone: "warn" },
  new: { label: "New", tone: "warn" },
  changed: { label: "Changed", tone: "warn" },
  rejected: { label: "Rejected", tone: "bad" },
};

const DESIGN_BADGES = {
  stale: { label: "Design stale", tone: "warn" },
  deleted: { label: "Design deleted", tone: "bad" },
} as const satisfies Record<string, Badge>;

/** The badges of a story: its review state, then a design problem when one is known. */
export function badgesOf(entry: StoryStatusEntry): Badge[] {
  const status = STATUS_BADGES[entry.status];
  return entry.design === undefined ? [status] : [status, DESIGN_BADGES[entry.design]];
}
