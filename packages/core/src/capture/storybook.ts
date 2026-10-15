import { loadDepGraph, STATS_FILENAME, type DepGraph } from "@storyshelf/affected";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ModeMap,
  StoryEntry,
  StoryParameters,
  StorySourceAdapter,
  StoryViewportConfig,
  StoryViewportDefinition,
  Viewport,
} from "./adapter.ts";
import type { DiscoverOptions } from "./adapter.ts";
import { extractDesignUrl, type DesignUrlParser } from "./design.ts";
import { applyModes, buildGlobalsParam } from "./modes.ts";

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
      parameters?: StorybookParameters;
    }
  >;
}

/** Story parameters as serialized by the Storybook index. */
interface StorybookParameters {
  chromatic?: StoryParameters;
  storyshelf?: StoryParameters & { figma?: unknown };
  viewport?: StoryViewportConfig;
  design?: unknown;
}

/** Merge the `chromatic` and `storyshelf` parameter layers (`storyshelf` wins). */
export function mergeParameters(entry: {
  parameters?: StorybookParameters;
}): StoryParameters | undefined {
  const { figma: _figma, ...storyshelf } = entry.parameters?.storyshelf ?? {};
  const merged: StoryParameters = { ...entry.parameters?.chromatic, ...storyshelf };
  const modes = mergeModes(entry.parameters?.chromatic?.modes, entry.parameters?.storyshelf?.modes);
  if (modes) merged.modes = modes;
  if (entry.parameters?.viewport) merged.viewport = entry.parameters.viewport;
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Union both parameter keys' modes by name (`storyshelf` wins per mode). */
function mergeModes(chromatic?: ModeMap, storyshelf?: ModeMap): ModeMap | undefined {
  const merged = { ...chromatic, ...storyshelf };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * The Storybook `MINIMAL_VIEWPORTS` snapshot used to resolve a story's
 * `defaultViewport` name at capture time. Dimensions are the documented
 * stable set; inline `parameters.viewport.viewports` always win over these.
 */
export const STORYBOOK_BUILTIN_VIEWPORTS: Readonly<Record<string, Viewport>> = {
  mobile1: { name: "mobile1", width: 320, height: 568 },
  mobile2: { name: "mobile2", width: 414, height: 896 },
  tablet: { name: "tablet", width: 834, height: 1112 },
  desktop: { name: "desktop", width: 1024, height: 1280 },
};

/**
 * Resolve the viewports a story should be captured at: the project's global
 * list plus the story's Storybook default viewport (union), deduplicated by
 * name. An unresolvable or duplicate default contributes nothing extra.
 */
export function resolveStoryViewports(
  entry: Pick<StoryEntry, "parameters">,
  globalViewports: Viewport[],
): Viewport[] {
  const resolved = storyViewport(entry);
  const withDefault =
    resolved && !globalViewports.some((v) => v.name === resolved.name)
      ? [...globalViewports, resolved]
      : [...globalViewports];
  return applyModes(entry.parameters?.modes, withDefault, (name) => namedViewport(entry, name));
}

/** Resolve a Storybook viewport name via the story's inline config, then builtins. */
function namedViewport(entry: Pick<StoryEntry, "parameters">, name: string): Viewport | undefined {
  const inline = entry.parameters?.viewport?.viewports?.[name];
  return (
    (inline ? viewportFromInline(name, inline) : undefined) ?? STORYBOOK_BUILTIN_VIEWPORTS[name]
  );
}

function storyViewport(entry: Pick<StoryEntry, "parameters">): Viewport | undefined {
  const config = entry.parameters?.viewport;
  const name = config?.defaultViewport;
  const inline = name ? config?.viewports?.[name] : undefined;
  const resolved =
    name && inline
      ? viewportFromInline(name, inline)
      : name
        ? STORYBOOK_BUILTIN_VIEWPORTS[name]
        : undefined;
  return resolved;
}

function viewportFromInline(
  defaultName: string,
  inline: StoryViewportDefinition,
): Viewport | undefined {
  const dims = viewportDims(inline.styles);
  return dims ? { name: inline.name ?? defaultName, ...dims } : undefined;
}

function viewportDims(
  styles: StoryViewportDefinition["styles"] | undefined,
): { width: number; height: number } | undefined {
  const width = pxOf(styles?.width);
  const height = pxOf(styles?.height);
  return width !== undefined && height !== undefined ? { width, height } : undefined;
}

function pxOf(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return Math.round(value);
  const bare = typeof value === "string" ? value.trim() : "";
  const match = /^(\d+(?:\.\d+)?)px$/u.exec(bare);
  return match ? Number(match[1]) : undefined;
}

function toStoryEntry(
  entry: StorybookIndex["entries"][string],
  parseDesignUrl?: DesignUrlParser,
): StoryEntry {
  const design = parseDesignUrl ? extractDesignUrl(entry.parameters, parseDesignUrl) : {};
  const story: StoryEntry = {
    id: entry.id,
    title: entry.title,
    name: entry.name,
    importPath: entry.importPath,
    tags: entry.tags,
    type: entry.type === "docs" ? "docs" : "story",
    parameters: mergeParameters(entry),
  };
  if (design.url) story.designUrl = design.url;
  if (design.invalid) story.designInvalid = design.invalid;
  return story;
}

/** Discovers stories from a built Storybook via its index file. */
export class StorybookAdapter implements StorySourceAdapter {
  readonly name = "storybook";
  readonly screenshotSelector = "#storybook-root";

  async discover(source: string, options: DiscoverOptions = {}): Promise<StoryEntry[]> {
    const index = await this.readIndex(source);
    return Object.values(index.entries)
      .filter((entry) => entry.type !== "docs" && entry.subtype !== "test")
      .map((entry) => toStoryEntry(entry, options.parseDesignUrl));
  }

  // eslint-disable-next-line class-methods-use-this
  buildUrl(baseUrl: string, storyId: string, globals?: Record<string, unknown>): string {
    const url = `${baseUrl}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`;
    const param = globals ? buildGlobalsParam(globals) : "";
    return param === "" ? url : `${url}&globals=${encodeURIComponent(param)}`;
  }

  /**
   * Load the Vite stats dependency graph of an extracted build for affected
   * capture. Resolves `null` when the build ships no usable stats, in which
   * case the orchestrator renders every story.
   */
  // eslint-disable-next-line class-methods-use-this
  async loadDependencyGraph(source: string): Promise<DepGraph | null> {
    return await loadDepGraph(join(source, STATS_FILENAME));
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
