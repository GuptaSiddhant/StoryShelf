import { parseDesignUrl } from "@storyshelf/core/adapter/design";
import type { CatalogEntry } from "@storyshelf/core/capture";
import {
  DesignCredentialModel,
  DesignModel,
  designDrift,
  normalizeImportPath,
  resolveDesigns,
  type DesignDrift,
} from "@storyshelf/core/models";
import type { Build, DesignNode, Project, Snapshot } from "@storyshelf/core/schema";
import { credentialKeys } from "../credential-keys.ts";
import type {
  CoverageComponent,
  CoverageLink,
  DesignCoverageData,
} from "../pages/design-coverage.tsx";
import { groupLibrary } from "../pages/library-model.ts";
import { getStore, testingEnabled } from "../store.ts";
import { viewerIdOf } from "./design-connect.handlers.ts";
import { nodeModel, providerNameFor } from "./design.handlers.ts";

/** Order of severity when a component links several designs: the worst one speaks for it. */
const SEVERITY: readonly DesignDrift[] = ["deleted", "stale", "unknown", "current"];

/** Coverage of a build's components: what lacks a design link, what drifted, and what is in sync. */
export async function coverageOf(
  project: Project,
  build: Build,
  entries: readonly CatalogEntry[],
  snapshots: readonly Snapshot[],
): Promise<DesignCoverageData> {
  const { db, design } = getStore();
  const manual = await new DesignModel(db, design).componentLinks(project.id);
  const resolutions = resolveDesigns(manual, snapshots);
  const components = groupLibrary(entries).filter((group) => group.importPath !== "");
  const urls = [...new Set([...resolutions.values()].flatMap((resolution) => resolution.urls))];
  const [cached, withToken] = await Promise.all([
    nodeModel()
      .cachedFor(project.id, urls, viewerIdOf())
      .catch(() => new Map<string, DesignNode>()),
    providersWithToken(project, urls),
  ]);
  const baselines = latestBaselineVersions(snapshots);
  const rows = components.map((group) => {
    const key = normalizeImportPath(group.importPath);
    const baseline = baselines.get(key) ?? null;
    const links = (resolutions.get(key)?.urls ?? []).map((url): CoverageLink =>
      linkOf(url, cached.get(url), baseline, withToken),
    );
    return { title: group.title, importPath: group.importPath, links };
  });
  return {
    ...summarize(project, build, rows, urls, withToken),
    storyLinksRead: testingEnabled(),
  };
}

function linkOf(
  url: string,
  node: DesignNode | undefined,
  baseline: string | null,
  withToken: ReadonlySet<string>,
): CoverageLink {
  const kind = parseDesignUrl(getStore().design, url)?.provider.metadata.kind ?? "";
  // Without a project token nothing says whether the design changed, whatever a member's own
  // connection cached: report it as unknown rather than guess.
  const drift = withToken.has(kind) ? designDrift(node, baseline) : "unknown";
  return { url, providerName: providerNameFor(url), name: node?.name ?? null, drift };
}

/**
 * When each component's baselines were last approved: the newest real `baselineVersion` among its
 * snapshots, by normalized story file. A snapshot with no baseline (`none`) has no approval time.
 */
function latestBaselineVersions(snapshots: readonly Snapshot[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const snap of snapshots) {
    const version = snap.baselineVersion;
    if (!snap.storyImportPath || !version || !Number.isFinite(Date.parse(version))) continue;
    const key = normalizeImportPath(snap.storyImportPath);
    const known = latest.get(key);
    if (known === undefined || Date.parse(version) > Date.parse(known)) latest.set(key, version);
  }
  return latest;
}

/** Provider kinds, among those the links use, that the project has a token for. */
async function providersWithToken(project: Project, urls: readonly string[]): Promise<Set<string>> {
  const credentials = new DesignCredentialModel(getStore().db, credentialKeys(getStore().config));
  const kinds = new Set(
    urls.flatMap((url) => parseDesignUrl(getStore().design, url)?.provider.metadata.kind ?? []),
  );
  const have = await Promise.all(
    [...kinds].map(async (kind) => ((await credentials.info(project.id, kind)) ? kind : null)),
  );
  return new Set(have.flatMap((kind) => (kind === null ? [] : [kind])));
}

function worst(links: readonly CoverageLink[]): DesignDrift {
  return SEVERITY.find((drift) => links.some((link) => link.drift === drift)) ?? "unknown";
}

function summarize(
  project: Project,
  build: Build,
  rows: readonly CoverageComponent[],
  urls: readonly string[],
  withToken: ReadonlySet<string>,
): Omit<DesignCoverageData, "storyLinksRead"> {
  const linked = rows.filter((row) => row.links.length > 0);
  const kinds = [...new Set(urls.map((url) => parseDesignUrl(getStore().design, url)?.provider))];
  return {
    project,
    build,
    unlinked: rows.filter((row) => row.links.length === 0),
    drifted: linked.filter((row) => ["deleted", "stale"].includes(worst(row.links))),
    current: linked.filter((row) => worst(row.links) === "current").length,
    unknown: linked.filter((row) => worst(row.links) === "unknown").length,
    withoutToken: kinds.flatMap((provider) =>
      provider && !withToken.has(provider.metadata.kind) ? [provider.metadata.name] : [],
    ),
  };
}
