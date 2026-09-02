/** A single discoverable story or docs entry within a Storybook. */
export interface StoryEntry {
  id: string;
  title: string;
  name: string;
  importPath?: string;
  tags?: string[];
  type: "story" | "docs";
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

export const DEFAULT_VIEWPORTS: Viewport[] = [{ name: "desktop", width: 1280, height: 720 }];
