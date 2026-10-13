import {
  DesignModel,
  FigmaNodeModel,
  isDesignStale,
  resolveDesigns,
  normalizeImportPath,
  type DesignResolution,
} from "@storyshelf/core/models";
import type { FigmaNode, Project, Snapshot } from "@storyshelf/core/schema";
import { credentialKeys } from "../credential-keys.ts";
import type { DesignItem, ProjectDesignLink } from "../pages/design-links.tsx";
import { getStore } from "../store.ts";

/** Most a page render waits for fresh Figma metadata; slower fetches finish into the cache for next time. */
const REFRESH_BUDGET_MS = 1500;

/** Component (story file) → design link(s) for a build's snapshots; files without a link are absent. */
export async function loadDesignResolutions(
  project: Project,
  snapshots: readonly Snapshot[],
): Promise<Map<string, DesignResolution>> {
  const { db, config } = getStore();
  const model = new DesignModel(db, undefined, credentialKeys(config));
  return resolveDesigns(await model.componentLinks(project.id), snapshots);
}

/** Design URLs of one snapshot's component. */
export function designUrlsFor(
  resolutions: Map<string, DesignResolution>,
  snapshot: Pick<Snapshot, "storyImportPath">,
): string[] {
  const key = snapshot.storyImportPath ? normalizeImportPath(snapshot.storyImportPath) : "";
  return resolutions.get(key)?.urls ?? [];
}

/** Project-level design file links for the library header. */
export async function loadProjectDesignLinks(project: Project): Promise<ProjectDesignLink[]> {
  const { db, config } = getStore();
  const links = await new DesignModel(db, undefined, credentialKeys(config)).projectLinks(
    project.id,
  );
  return links.map((link) => ({ label: link.label ?? "Design", url: link.url }));
}

/**
 * Design items for the review page: each link with cached name/state and a
 * stale flag against the snapshot's baseline. Refreshes expired metadata
 * within a short budget; failures degrade to plain deep links, never blocking review.
 */
export async function loadReviewDesign(
  project: Project,
  snapshot: Snapshot,
  urls: readonly string[],
): Promise<DesignItem[]> {
  if (urls.length === 0) return [];
  const { db, config, logger } = getStore();
  const design = new DesignModel(db, undefined, credentialKeys(config));
  const nodes = new FigmaNodeModel(db, design, undefined, logger);
  await refreshWithinBudget(nodes, project.id, urls);
  const cached = await nodes.cachedFor(project.id, urls).catch(() => new Map<string, FigmaNode>());
  return urls.map((url) => {
    const node = cached.get(url);
    return {
      url,
      name: node?.name ?? null,
      state: node?.state ?? "unknown",
      stale: isDesignStale(node, snapshot.baselineVersion),
    };
  });
}

async function refreshWithinBudget(
  nodes: FigmaNodeModel,
  projectId: string,
  urls: readonly string[],
): Promise<void> {
  const refresh = Promise.all(urls.map(async (url) => await nodes.refresh(projectId, url))).catch(
    () => [],
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, REFRESH_BUDGET_MS);
  });
  await Promise.race([refresh, budget]);
  clearTimeout(timer);
}
