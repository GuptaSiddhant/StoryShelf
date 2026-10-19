/** Reads the capture-environment migrations recorded on a build's snapshots. */
import type { EnvironmentChange } from "@storyshelf/core/capture";
import type { Snapshot } from "@storyshelf/core/schema";

/** What changed, in words a reviewer recognises. */
const FIELD_LABELS: Record<string, string> = {
  engine: "browser engine",
  browserVersion: "browser version",
  platform: "host platform",
  deviceScaleFactor: "device scale factor",
  fontsHash: "installed fonts",
  viewport: "viewport size",
  sizing: "screenshot sizing",
  unknown: "capture environment",
};

/** A snapshot's recorded change; null when it has none or the stored value is unreadable. */
export function environmentChangeOf(
  snapshot: Pick<Snapshot, "envChange">,
): EnvironmentChange | null {
  if (!snapshot.envChange) {
    return null;
  }
  try {
    const value = JSON.parse(snapshot.envChange) as Partial<EnvironmentChange>;
    return Array.isArray(value.changed) && value.to ? (value as EnvironmentChange) : null;
  } catch {
    return null;
  }
}

/** Summary across a build's snapshots. */
export interface EnvironmentChangeSummary {
  /** Snapshots accepted as a migration. */
  count: number;
  /** Distinct labels of what changed, in first-seen order. */
  fields: string[];
  /** `from -> to` for the browser version when every migrated snapshot agrees on it. */
  browserVersion?: { from: string; to: string };
}

/** Summarise the build's environment migrations, or null when there were none. */
export function summariseEnvironmentChanges(
  snapshots: readonly Pick<Snapshot, "envChange">[],
): EnvironmentChangeSummary | null {
  const changes = snapshots
    .map((snapshot) => environmentChangeOf(snapshot))
    .filter((change): change is EnvironmentChange => change !== null);
  if (changes.length === 0) {
    return null;
  }
  const fields = [...new Set(changes.flatMap((change) => change.changed))].map((field) =>
    labelOf(field),
  );
  return { count: changes.length, fields, ...browserVersionOf(changes) };
}

/** Human label for a changed component. */
export function labelOf(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function browserVersionOf(
  changes: EnvironmentChange[],
): Pick<EnvironmentChangeSummary, "browserVersion"> {
  const pairs = new Set(
    changes.map(
      (change) => `${change.from?.browserVersion ?? ""}\u0000${change.to.browserVersion ?? ""}`,
    ),
  );
  if (pairs.size !== 1) {
    return {};
  }
  const [from, to] = [...pairs][0]?.split("\u0000") ?? [];
  return from && to && from !== to ? { browserVersion: { from, to } } : {};
}
