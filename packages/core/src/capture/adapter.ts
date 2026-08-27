export interface StoryEntry {
  id: string;
  title: string;
  name: string;
  importPath?: string;
  tags?: string[];
  type: "story" | "docs";
}

export interface StorySourceAdapter {
  name: string;
  discover(source: string): Promise<StoryEntry[]>;
  buildUrl(baseUrl: string, storyId: string): string;
  screenshotSelector?: string;
}

export interface Viewport {
  name: string;
  width: number;
  height: number;
}
