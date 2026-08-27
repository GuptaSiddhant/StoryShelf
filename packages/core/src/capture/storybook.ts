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

  async discover(source: string): Promise<StoryEntry[]> {
    const index = await this.readIndex(source);
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

  buildUrl(baseUrl: string, storyId: string): string {
    return `${baseUrl}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`;
  }

  private async readIndex(source: string): Promise<StorybookIndex> {
    for (const name of ["index.json", "stories.json"]) {
      try {
        const raw = await readFile(join(source, name), "utf8");
        return JSON.parse(raw) as StorybookIndex;
      } catch {
        continue;
      }
    }
    throw new Error(`No Storybook index found in ${source}`);
  }
}
