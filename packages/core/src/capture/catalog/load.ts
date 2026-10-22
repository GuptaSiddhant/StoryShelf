/**
 * The catalog loader: a build's catalog from `catalog.json`, kept in a small in-process LRU cache
 * by build id; a build that has none (published before the catalog existed) is catalogued on first
 * view from its persisted statics (ADR 0006, decision 9).
 */
import type { Logger } from "../../logger.ts";
import { catalogueBuild, readCatalog, type CatalogDeps } from "./catalogue.ts";
import type { Catalog } from "./types.ts";

/** Reads catalogs; one per app, so the cache is shared by every request. */
export interface CatalogLoader {
  /** The build's catalog, or null when it has no catalog and no readable index. */
  load(projectId: string, buildId: string): Promise<Catalog | null>;
  /** Catalogue the build again from its statics (a publish ended) and cache the result. */
  refresh(projectId: string, buildId: string): Promise<Catalog | null>;
}

/** Catalogs kept in memory by default. */
export const DEFAULT_CATALOG_CACHE_SIZE = 32;

/** What {@link createCatalogLoader} needs. */
export interface CatalogLoaderOptions extends CatalogDeps {
  /** Catalogs kept in memory (least recently used leave first). */
  cacheSize?: number;
  logger?: Logger;
}

/** A loader over `options.db` and `options.storage`. */
export function createCatalogLoader(options: CatalogLoaderOptions): CatalogLoader {
  const limit = Math.max(1, options.cacheSize ?? DEFAULT_CATALOG_CACHE_SIZE);
  const cache = new Map<string, Catalog>();
  const inflight = new Map<string, Promise<Catalog | null>>();
  const remember = (buildId: string, catalog: Catalog): Catalog => {
    cache.delete(buildId);
    cache.set(buildId, catalog);
    const oldest = cache.keys().next().value;
    if (cache.size > limit && oldest !== undefined) {
      cache.delete(oldest);
    }
    return catalog;
  };
  const fetchCatalog = async (projectId: string, buildId: string): Promise<Catalog | null> => {
    const stored = await readCatalog(options.storage, projectId, buildId);
    if (stored) {
      return stored;
    }
    options.logger?.info({ buildId }, "cataloguing a build published before the catalog");
    return await catalogueBuild(options, projectId, buildId);
  };
  return {
    load: async (projectId, buildId) => {
      const hit = cache.get(buildId);
      if (hit) {
        return remember(buildId, hit);
      }
      const pending = inflight.get(buildId) ?? fetchCatalog(projectId, buildId);
      inflight.set(buildId, pending);
      try {
        const catalog = await pending;
        return catalog ? remember(buildId, catalog) : null;
      } finally {
        inflight.delete(buildId);
      }
    },
    refresh: async (projectId, buildId) => {
      cache.delete(buildId);
      const catalog = await catalogueBuild(options, projectId, buildId);
      return catalog ? remember(buildId, catalog) : null;
    },
  };
}
