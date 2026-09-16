/** Per-story capture parameters from the Storybook index. */
export interface StoryParameters {
  disableSnapshot?: boolean;
  delay?: number;
  diffThreshold?: number;
  pauseAnimationAtEnd?: boolean;
  flakyTest?: boolean;
  /** Force auto-crop (true) or full viewport (false) for this story; undefined uses 60% whitespace rule. */
  autoCrop?: boolean;
  /** Whitespace fraction (0..1) above which we crop; default 0.6. */
  autoCropThreshold?: number;
  /** Whether overflow should trigger fullPage; default true. */
  fullPageOnOverflow?: boolean;
  /** Min dimensions for the final PNG (clamp after padding). */
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

/** Return whether a story is marked flaky (failures stay non-blocking). */
export function isFlakyStory(entry: Pick<StoryEntry, "tags" | "parameters">): boolean {
  if (entry.parameters?.flakyTest) return true;
  const tags = entry.tags ?? [];
  for (const t of tags) {
    if (t.toLowerCase() === "flaky-test") return true;
  }
  return false;
}

/** Return whether a story is excluded from snapshot capture. */
export function isDisabledStory(entry: Pick<StoryEntry, "tags" | "parameters">): boolean {
  if (entry.parameters?.disableSnapshot) return true;
  const tags = entry.tags ?? [];
  for (const t of tags) {
    const lower = t.toLowerCase();
    if (lower === "skip" || lower === "disable" || lower === "disable-snapshot") return true;
  }
  return false;
}

/** A single discoverable story or docs entry within a Storybook. */
export interface StoryEntry {
  id: string;
  title: string;
  name: string;
  importPath?: string;
  tags?: string[];
  type: "story" | "docs";
  parameters?: StoryParameters;
}

/** Adapter that discovers and renders stories from a Storybook build. */
export interface StorySourceAdapter {
  name: string;
  discover(source: string): Promise<StoryEntry[]>;
  buildUrl(baseUrl: string, storyId: string): string;
  screenshotSelector?: string;
}

/** A viewport size at which stories are captured. */
export interface Viewport {
  name: string;
  width: number;
  height: number;
}

/** Default viewport used when none is configured. */
export const DEFAULT_VIEWPORTS: Viewport[] = [{ name: "desktop", width: 1280, height: 720 }];
