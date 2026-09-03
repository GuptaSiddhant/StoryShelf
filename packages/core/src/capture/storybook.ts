import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { StoryEntry, StorySourceAdapter } from "./adapter.ts";

interface StorybookIndex {
  v: number;
  entries: Record<string, { id: string; name: string; title: string; importPath?: string; tags?: string[]; type: string }>;
}

export class StorybookAdapter implements StorySourceAdapter {
  readonly name = "storybook";
  readonly screenshotSelector = "#storybook-root";

  // eslint-disable-next-line class-methods-use-this
  async discover(source: string): Promise<StoryEntry[]> {
    const index = await StorybookAdapter.readIndex(source);
    return Object.values(index.entries)
      .filter((entry) => entry.type !== "docs")
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        name: entry.name,
        importPath: entry.importPath,
        tags: entry.tags,
        type: entry.type === "docs" ? "docs" : "story",
      }));
  }

  static buildUrl(baseUrl: string, storyId: string): string {
    return `${baseUrl}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`;
  }

  private static async readIndex(source: string): Promise<StorybookIndex> {
    const candidates = ["index.json", "stories.json"];
    const results = await Promise.all(
      candidates.map(async (name) => {
        try {
          const raw = await readFile(join(source, name), "utf8");
          return JSON.parse(raw) as StorybookIndex;
        } catch {
          return null;
        }
      }),
    );
    const found = results.find((index) => index !== null);
    if (found) {
      return found;
    }
    throw new Error(`No Storybook index found in ${source}`);
  }
}
