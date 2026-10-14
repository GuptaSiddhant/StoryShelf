import { parseDesignUrl } from "@storyshelf/core/adapter/design";
import {
  DesignCredentialModel,
  DesignModel,
  DesignNodeModel,
  isDesignStale,
  resolveDesigns,
  normalizeImportPath,
  type DesignResolution,
} from "@storyshelf/core/models";
import type { DesignNode, Project, Snapshot } from "@storyshelf/core/schema";
import { credentialKeys } from "../credential-keys.ts";
import type { DesignItem, DesignPreviewInfo, ProjectDesignLink } from "../pages/design-links.tsx";
import { getStore } from "../store.ts";

/** Most a page render waits for fresh design metadata; slower fetches finish into the cache for next time. */
const REFRESH_BUDGET_MS = 1500;

/** Component (story file) → design link(s) for a build's snapshots; files without a link are absent. */
export async function loadDesignResolutions(
  project: Project,
  snapshots: readonly Snapshot[],
): Promise<Map<string, DesignResolution>> {
  const { db, design } = getStore();
  if (design.length === 0) return new Map();
  const model = new DesignModel(db, design);
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
  const { db, design } = getStore();
  if (design.length === 0) return [];
  const links = await new DesignModel(db, design).projectLinks(project.id);
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
  const nodes = nodeModel();
  await refreshWithinBudget(nodes, project.id, urls);
  const cached = await nodes.cachedFor(project.id, urls).catch(() => new Map<string, DesignNode>());
  return urls.map((url) => {
    const node = cached.get(url);
    return {
      url,
      name: node?.name ?? null,
      providerName: providerNameFor(url),
      renderUrl: renderUrlOf(project, node),
      state: node?.state ?? "unknown",
      stale: isDesignStale(node, snapshot.baselineVersion),
    };
  });
}

/** Most distinct design links a library render refreshes (the model bounds file concurrency). */
const WARM_LIMIT = 10;

/**
 * Cached name/render per design URL for library popovers. Missing or expired
 * entries are refreshed first, within the page-render budget and with bounded
 * concurrency, so a slow design API never holds the library up or fans out unbounded.
 */
export async function loadDesignPreviews(
  project: Project,
  urls: readonly string[],
): Promise<Map<string, DesignPreviewInfo>> {
  const distinct = [...new Set(urls)];
  if (distinct.length === 0) return new Map();
  const nodes = nodeModel();
  await refreshWithinBudget(nodes, project.id, distinct.slice(0, WARM_LIMIT));
  const cached = await nodes
    .cachedFor(project.id, distinct)
    .catch(() => new Map<string, DesignNode>());
  return new Map(
    [...cached].map(([url, node]) => [
      url,
      { name: node.name, renderUrl: renderUrlOf(project, node) },
    ]),
  );
}

function nodeModel(): DesignNodeModel {
  const { db, config, logger, storage, design } = getStore();
  const credentials = new DesignCredentialModel(db, credentialKeys(config));
  return new DesignNodeModel(db, credentials, design, { logger, storage });
}

/** Display name of the provider that owns a design link ("Figma"), or a generic fallback. */
export function providerNameFor(url: string): string {
  return parseDesignUrl(getStore().design, url)?.provider.metadata.name ?? "Design";
}

/** API URL of a node's cached render (version-busted), or null when none is cached. */
function renderUrlOf(project: Project, node: DesignNode | undefined): string | null {
  return node?.renderPath
    ? `/api/v1/projects/${project.slug}/design/renders/${node.id}?v=${encodeURIComponent(node.renderVersion ?? "")}`
    : null;
}

/** Refresh the links, aborting every provider call once the budget is spent (the cache keeps what landed). */
async function refreshWithinBudget(
  nodes: DesignNodeModel,
  projectId: string,
  urls: readonly string[],
): Promise<void> {
  await nodes
    .refreshMany(projectId, urls, { signal: AbortSignal.timeout(REFRESH_BUDGET_MS) })
    .catch(() => new Map());
}
