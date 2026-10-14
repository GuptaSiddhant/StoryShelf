/** Figma metadata + render cache: TTL refresh, batched per file, with bounded concurrency. */
import { and, eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { Buffer } from "node:buffer";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Logger } from "../logger.ts";
import type { FigmaNode } from "../schema/design.ts";
import { parseFigmaUrl, type FigmaRef } from "../utils/figma-url.ts";
import { mapLimit } from "../utils/map-limit.ts";
import { ulid } from "../utils/ulid.ts";
import type { DesignTokenStatus } from "./design-resolve.ts";
import type { DesignModel } from "./design.ts";
import {
  fetchFigmaMetas,
  refKey,
  type FigmaCallOptions,
  type FigmaMeta,
  type FigmaState,
} from "./figma-api.ts";
import { FIGMA_TTL_MS } from "./figma-health.ts";
import { FigmaRenderStore } from "./figma-renders.ts";

/** Most files refreshed in parallel by one {@link FigmaNodeModel.refreshMany} call. */
const FILE_CONCURRENCY = 3;

/** Tables required by {@link FigmaNodeModel}. */
export interface FigmaNodeTables {
  figmaNodes: Table;
}

/** Options of {@link FigmaNodeModel.refreshMany}. */
export interface RefreshOptions {
  now?: Date;
  /** Cancels in-flight Figma calls (e.g. a page-render budget). */
  signal?: AbortSignal;
}

interface Due {
  url: string;
  ref: FigmaRef;
  cached: FigmaNode | null;
}

/** Cache of Figma file/node metadata and node renders with TTL refresh. */
export class FigmaNodeModel {
  private readonly tables: FigmaNodeTables;
  private readonly renders: FigmaRenderStore;
  private readonly logger: Logger | undefined;
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly design: DesignModel,
    options: { tables?: FigmaNodeTables; logger?: Logger; storage?: StorageAdapter } = {},
  ) {
    this.tables = options.tables ?? { figmaNodes: db.tables.figmaNodes };
    this.renders = new FigmaRenderStore(
      db,
      this.tables.figmaNodes,
      options.storage,
      options.logger,
    );
    this.logger = options.logger;
  }

  /** Cached row by id, scoped to the project, or null. */
  async get(projectId: string, id: string): Promise<FigmaNode | null> {
    const row = (await this.db.get(this.tables.figmaNodes, id)) as unknown as FigmaNode | null;
    return row?.projectId === projectId ? row : null;
  }

  /** Cached render bytes of a node, or null when it has none (or storage is not wired). */
  async readRender(node: FigmaNode): Promise<Buffer | null> {
    return await this.renders.read(node);
  }

  /** Cached rows for the given design URLs, keyed by URL (missing/unparseable URLs are absent). */
  async cachedFor(projectId: string, urls: readonly string[]): Promise<Map<string, FigmaNode>> {
    const rows = await Promise.all(
      [...new Set(urls)].map(async (url) => {
        const ref = parseFigmaUrl(url);
        return [url, ref ? await this.lookup(projectId, ref) : null] as const;
      }),
    );
    return new Map(rows.flatMap(([url, row]) => (row ? [[url, row] as const] : [])));
  }

  /** Refresh one link (see {@link refreshMany}); null for non-Figma URLs or nothing cached. */
  async refresh(projectId: string, url: string, now?: Date): Promise<FigmaNode | null> {
    const results = await this.refreshMany(projectId, [url], now ? { now } : {});
    return results.get(url) ?? null;
  }

  /**
   * Refresh the given links' metadata and renders when missing or past the TTL.
   * Links of one file share one metadata call and one render call, and files run
   * with bounded concurrency. Transient failures keep the previous cache; auth
   * failures update the token's health. Never throws.
   */
  async refreshMany(
    projectId: string,
    urls: readonly string[],
    options: RefreshOptions = {},
  ): Promise<Map<string, FigmaNode | null>> {
    const now = options.now ?? new Date();
    const lookups = await Promise.all(
      [...new Set(urls)].map(async (url) => {
        const ref = parseFigmaUrl(url);
        return ref ? { url, ref, cached: await this.lookup(projectId, ref) } : null;
      }),
    );
    const known = lookups.filter((item) => item !== null);
    const results = new Map<string, FigmaNode | null>(known.map((item) => [item.url, item.cached]));
    const due = known.filter((item) => isDue(item.cached, now));
    const token = due.length > 0 ? await this.design.getToken(projectId).catch(() => null) : null;
    if (!token) return results;
    const fresh = await this.refreshDue(
      projectId,
      token,
      due,
      now,
      callOptions(this.logger, options),
    );
    for (const [url, node] of fresh) results.set(url, node);
    return results;
  }

  /** Refresh due links grouped by file, files in parallel (bounded). */
  private async refreshDue(
    projectId: string,
    token: string,
    due: Due[],
    now: Date,
    call: FigmaCallOptions,
  ): Promise<Map<string, FigmaNode>> {
    const byFile = [...Map.groupBy(due, (item) => item.ref.fileKey)];
    const batches = await mapLimit(byFile, FILE_CONCURRENCY, async ([fileKey, items]) => {
      return await this.refreshFile(projectId, token, fileKey, items, now, call);
    });
    const merged = new Map<string, FigmaNode>();
    for (const batch of batches) {
      for (const [url, node] of batch) merged.set(url, node);
    }
    return merged;
  }

  private async refreshFile(
    projectId: string,
    token: string,
    fileKey: string,
    items: Due[],
    now: Date,
    call: FigmaCallOptions,
  ): Promise<Map<string, FigmaNode>> {
    const metas = await fetchFigmaMetas(
      token,
      fileKey,
      items.map((item) => item.ref),
      call,
    );
    const answered = [...metas.values()].find((meta) => meta.state !== "error");
    if (answered) await this.design.recordTokenStatus(projectId, tokenStatusFor(answered.state));
    const rows = await Promise.all(
      items.map(async (item) => {
        const meta = metas.get(refKey(item.ref));
        const row =
          meta && meta.state !== "error" ? await this.store(projectId, item, meta, now) : null;
        return row ? ([item.url, row] as const) : null;
      }),
    );
    const stored = new Map(rows.filter((entry) => entry !== null));
    return await this.renders.ensure(projectId, token, fileKey, stored, call);
  }

  private async lookup(projectId: string, ref: FigmaRef): Promise<FigmaNode | null> {
    const columns = getTableColumns(this.tables.figmaNodes);
    const rows = (await this.db.list(this.tables.figmaNodes, {
      where: and(
        eq(columns["projectId"] as unknown as SQLWrapper, projectId),
        eq(columns["fileKey"] as unknown as SQLWrapper, ref.fileKey),
        eq(columns["nodeId"] as unknown as SQLWrapper, ref.nodeId ?? ""),
      ),
      limit: 1,
    })) as unknown as FigmaNode[];
    return rows[0] ?? null;
  }

  /**
   * Upsert the row. Non-ok states keep the last good name/version/modified time
   * (an auth failure must not erase the label); a deleted node also drops its
   * cached render, so a design that no longer exists is never shown as reference.
   */
  private async store(
    projectId: string,
    item: Due,
    meta: FigmaMeta,
    now: Date,
  ): Promise<FigmaNode> {
    const { ref, cached } = item;
    const stamp = now.toISOString();
    const keep = meta.state !== "ok" && cached;
    const values = {
      name: keep ? cached.name : meta.name,
      version: keep ? cached.version : meta.version,
      lastModified: keep ? cached.lastModified : meta.lastModified,
      state: meta.state,
      fetchedAt: stamp,
      updatedAt: stamp,
    };
    if (!cached) {
      return (await this.db.insert(this.tables.figmaNodes, {
        id: ulid(),
        projectId,
        fileKey: ref.fileKey,
        nodeId: ref.nodeId ?? "",
        renderPath: null,
        renderVersion: null,
        createdAt: stamp,
        ...values,
      })) as unknown as FigmaNode;
    }
    const dropRender = meta.state === "deleted" && cached.renderPath !== null;
    if (dropRender) await this.renders.remove(cached);
    return (await this.db.update(this.tables.figmaNodes, cached.id, {
      ...values,
      ...(dropRender ? { renderPath: null, renderVersion: null } : {}),
    })) as unknown as FigmaNode;
  }
}

/** Never fetched, or cached longer ago than the TTL. */
function isDue(cached: FigmaNode | null, now: Date): boolean {
  return !cached || now.getTime() - Date.parse(cached.fetchedAt) >= FIGMA_TTL_MS;
}

function callOptions(logger: Logger | undefined, options: RefreshOptions): FigmaCallOptions {
  return {
    ...(logger ? { logger } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

function tokenStatusFor(state: FigmaState): DesignTokenStatus {
  return state === "unauthorized" || state === "forbidden" ? state : "ok";
}
