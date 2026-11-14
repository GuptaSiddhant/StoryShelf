import { loadManifest } from "@storyshelf/core/capture";
import { maxOfflineDaysOf } from "@storyshelf/core/config";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { contentKey, storybookDir } from "@storyshelf/core/utils";
import { posix } from "node:path";
import { getStore } from "../store.ts";
import { publishedAccess } from "./published-access.ts";

/** Most project slugs one sync may ask about. */
export const MAX_OFFLINE_PROJECTS = 100;

/** One file of a kept build: its path, content hash and size in bytes. */
export interface OfflineEntry {
  path: string;
  hash: string;
  size: number;
}

/** One project the caller may keep offline (ADR 0048, decision 3). */
export interface OfflineProject {
  slug: string;
  name: string;
  buildId: string;
  commit: string;
  entries: OfflineEntry[];
  maxOfflineDays: number;
}

/** Sizes by content hash. A blob's bytes never change under its hash, so a size is kept for good. */
const sizes = new Map<string, number>();
const SIZE_CONCURRENCY = 8;

async function measure(hash: string): Promise<number> {
  const known = sizes.get(hash);
  if (known !== undefined) return known;
  let bytes = 0;
  for await (const chunk of await getStore().storage.readStream(contentKey(hash))) {
    bytes += (chunk as Buffer).length;
  }
  sizes.set(hash, bytes);
  return bytes;
}

async function sizesOf(hashes: readonly string[]): Promise<Map<string, number>> {
  const queue = [...new Set(hashes)];
  const out = new Map<string, number>();
  const worker = async (): Promise<void> => {
    for (let hash = queue.pop(); hash !== undefined; hash = queue.pop()) {
      // oxlint-disable-next-line no-await-in-loop -- each worker takes one blob at a time
      out.set(hash, await measure(hash));
    }
  };
  await Promise.all(Array.from({ length: SIZE_CONCURRENCY }, worker));
  return out;
}

/**
 * The project's offline answer, or null when the caller may not read the build or it has no
 * published manifest. A caller with no access gets what an unknown slug gets: nothing.
 */
async function offlineProjectOf(project: Project, build: Build): Promise<OfflineProject | null> {
  const { config, storage } = getStore();
  if (!(await publishedAccess(build, project))) return null;
  const manifest = await loadManifest(storage, storybookDir(project.id, build.id));
  if (!manifest) return null;
  const sized = await sizesOf([...manifest.values()]);
  const entries = [...manifest].map(([path, hash]) => ({
    path: posix.normalize(path),
    hash,
    size: sized.get(hash) ?? 0,
  }));
  return {
    slug: project.slug,
    name: project.name,
    buildId: build.id,
    commit: build.gitSha,
    entries,
    maxOfflineDays: maxOfflineDaysOf(config),
  };
}

/**
 * For each requested slug the caller may read, the latest published build on the project's default
 * branch (the one a project short link opens). A slug that is unknown, hidden, or has no such build
 * is left out, so the answer never says which of them exist.
 */
export async function offlineProjectsOf(slugs: readonly string[]): Promise<OfflineProject[]> {
  const { db } = getStore();
  const found: OfflineProject[] = [];
  for (const slug of new Set(slugs.slice(0, MAX_OFFLINE_PROJECTS))) {
    // oxlint-disable-next-line no-await-in-loop -- bounded by MAX_OFFLINE_PROJECTS
    const project = await new ProjectModel(db).getBySlug(slug);
    // oxlint-disable-next-line no-await-in-loop -- bounded by MAX_OFFLINE_PROJECTS
    const build = project ? await new BuildModel(db).latestApprovedDefault(project) : null;
    // oxlint-disable-next-line no-await-in-loop -- bounded by MAX_OFFLINE_PROJECTS
    const entry = project && build ? await offlineProjectOf(project, build) : null;
    if (entry) found.push(entry);
  }
  return found;
}
