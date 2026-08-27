/** A single discoverable story or docs entry within a Storybook. */
export interface StoryEntry {
  /** Stable story ID. */
  id: string;
  /** Storybook title (component path). */
  title: string;
  /** Story display name. */
  name: string;
  /** Source import path, if available. */
  importPath?: string;
  /** Storybook tags, if available. */
  tags?: string[];
  /** Whether this entry is a story or a docs page. */
  type: "story" | "docs";
}

/** Adapter that discovers and renders stories from a Storybook build. */
export interface StorySourceAdapter {
  /** Adapter name, e.g. `storybook`. */
  name: string;
  /** Discover all stories in the given source directory. */
  discover(source: string): Promise<StoryEntry[]>;
  /** Build the iframe URL used to render a given story. */
  buildUrl(baseUrl: string, storyId: string): string;
  /** CSS selector of the element to screenshot, if the adapter defines one. */
  screenshotSelector?: string;
}

/** A viewport size at which stories are captured. */
export interface Viewport {
  /** Viewport name. */
  name: string;
  /** Viewport width in pixels. */
  width: number;
  /** Viewport height in pixels. */
  height: number;
}
