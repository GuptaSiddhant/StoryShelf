import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { StoryEntry, StoryParameters, StorySourceAdapter } from "./adapter.ts";

interface StorybookIndex {
  v: number;
  entries: Record<
    string,
    {
      id: string;
      name: string;
      title: string;
      importPath?: string;
      tags?: string[];
      type: string;
      subtype?: string;
      parameters?: { chromatic?: StoryParameters; storyshelf?: StoryParameters };
    }
  >;
}

function mergeParameters(entry: {
  parameters?: { chromatic?: StoryParameters; storyshelf?: StoryParameters };
}): StoryParameters | undefined {
  const merged: StoryParameters = {
    ...entry.parameters?.chromatic,
    ...entry.parameters?.storyshelf,
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export class StorybookAdapter implements StorySourceAdapter {
  readonly name = "storybook";
  readonly screenshotSelector = "#storybook-root";

  async discover(source: string): Promise<StoryEntry[]> {
    const index = await this.readIndex(source);
    return Object.values(index.entries)
      .filter((entry) => entry.type !== "docs" && entry.subtype !== "test")
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        name: entry.name,
        importPath: entry.importPath,
        tags: entry.tags,
        type: entry.type === "docs" ? "docs" : "story",
        parameters: mergeParameters(entry),
      }));
  }

  // eslint-disable-next-line class-methods-use-this
  buildUrl(baseUrl: string, storyId: string): string {
    return `${baseUrl}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`;
  }

  // eslint-disable-next-line class-methods-use-this
  private async readIndex(source: string): Promise<StorybookIndex> {
    const candidates: string[] = ["stories.json", "index.json"];
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
