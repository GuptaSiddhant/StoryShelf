/** Design metadata + render cache: TTL refresh, batched per file, bounded concurrency, abortable. */
import { and, eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { Buffer } from "node:buffer";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type {
  DesignCallOptions,
  DesignClient,
  DesignMeta,
  DesignProvider,
  DesignRef,
} from "../adapters/design.ts";
import { parseDesignUrl } from "../adapters/design.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Logger } from "../logger.ts";
import type { DesignNode } from "../schema/design.ts";
import { mapLimit } from "../utils/map-limit.ts";
import { ulid } from "../utils/ulid.ts";
import type { ConnectionModel } from "./connections.ts";
import { PROJECT_SCOPE, type DesignCredentialModel } from "./design-credentials.ts";
import { DESIGN_TTL_MS } from "./design-health.ts";
import { DesignRenderStore } from "./design-renders.ts";
import type { DesignCredentialStatus } from "./design-resolve.ts";

/** Most files refreshed in parallel by one {@link DesignNodeModel.refreshMany} call. */
const FILE_CONCURRENCY = 3;

/** Tables required by {@link DesignNodeModel}. */
export interface DesignNodeTables {
  designNodes: Table;
}

/** Options of {@link DesignNodeModel.refreshMany}. */
export interface RefreshOptions {
  now?: Date;
  /** Cancels in-flight provider calls (e.g. a page-render budget). */
  signal?: AbortSignal;
  /** The visiting user: their own connection is used when the project has no credential. */
  viewerId?: string;
}

interface Due {
  url: string;
  provider: DesignProvider;
  ref: DesignRef;
  cached: DesignNode | null;
  /** Whose credential fetches this link: {@link PROJECT_SCOPE} or the viewer's user id. */
  scope: string;
}

/** Cache of design file/node metadata and node renders with TTL refresh. */
export class DesignNodeModel {
  private readonly tables: DesignNodeTables;
  private readonly renders: DesignRenderStore;
  private readonly logger: Logger | undefined;
  private readonly connections: ConnectionModel | undefined;
  private readonly db: DatabaseAdapter;
  private readonly credentials: DesignCredentialModel;
  private readonly providers: readonly DesignProvider[];

  constructor(
    db: DatabaseAdapter,
    credentials: DesignCredentialModel,
    providers: readonly DesignProvider[],
    options: {
      tables?: DesignNodeTables;
      logger?: Logger;
      storage?: StorageAdapter;
      /** Members' own connections, used when the project has no credential. */
      connections?: ConnectionModel;
    } = {},
  ) {
    this.db = db;
    this.credentials = credentials;
    this.providers = providers;
    this.tables = options.tables ?? { designNodes: db.tables.designNodes };
    this.renders = new DesignRenderStore(
      db,
      this.tables.designNodes,
      options.storage,
      options.logger,
    );
    this.logger = options.logger;
    this.connections = options.connections;
  }

  /** Cached row by id, scoped to the project, or null. */
  async get(projectId: string, id: string): Promise<DesignNode | null> {
    const row = (await this.db.get(this.tables.designNodes, id)) as unknown as DesignNode | null;
    return row?.projectId === projectId ? row : null;
  }

  /** Cached render bytes of a node, or null when it has none (or storage is not wired). */
  async readRender(node: DesignNode): Promise<Buffer | null> {
    return await this.renders.read(node);
  }

  /**
   * Cached rows for the given design URLs, keyed by URL (unparseable or uncached URLs are
   * absent). A row fetched with someone's own connection is only visible to that viewer.
   */
  async cachedFor(
    projectId: string,
    urls: readonly string[],
    viewerId?: string,
  ): Promise<Map<string, DesignNode>> {
    const rows = await Promise.all(
      [...new Set(urls)].map(async (url) => {
        const parsed = parseDesignUrl(this.providers, url);
        const row = parsed
          ? await this.visible(projectId, parsed.provider.metadata.kind, parsed.ref, viewerId)
          : null;
        return [url, row] as const;
      }),
    );
    return new Map(rows.flatMap(([url, row]) => (row ? [[url, row] as const] : [])));
  }

  /** Refresh one link (see {@link refreshMany}); null for unsupported URLs or nothing cached. */
  async refresh(
    projectId: string,
    url: string,
    now?: Date,
    viewerId?: string,
  ): Promise<DesignNode | null> {
    const results = await this.refreshMany(projectId, [url], {
      ...(now ? { now } : {}),
      ...(viewerId ? { viewerId } : {}),
    });
    return results.get(url) ?? null;
  }

  /**
   * Refresh the given links' metadata and renders when missing or past the TTL.
   * Links of one file share one metadata call and one render call, and files run
   * with bounded concurrency. Transient failures keep the previous cache; auth
   * failures update the credential's health. Never throws.
   */
  async refreshMany(
    projectId: string,
    urls: readonly string[],
    options: RefreshOptions = {},
  ): Promise<Map<string, DesignNode | null>> {
    const now = options.now ?? new Date();
    const scopes = new Map<string, Promise<string>>();
    const lookups = await Promise.all(
      [...new Set(urls)].map(async (url) => {
        const parsed = parseDesignUrl(this.providers, url);
        if (!parsed) return null;
        const kind = parsed.provider.metadata.kind;
        const scope = await memo(scopes, kind, async () => {
          return await this.scopeFor(projectId, kind, options.viewerId);
        });
        const cached = await this.lookup(projectId, kind, parsed.ref, scope);
        return { url, provider: parsed.provider, ref: parsed.ref, cached, scope };
      }),
    );
    const known = lookups.filter((item) => item !== null);
    const results = new Map<string, DesignNode | null>(
      known.map((item) => [item.url, item.cached]),
    );
    const due = known.filter((item) => isDue(item.cached, now));
    if (due.length === 0) return results;
    const fresh = await this.refreshDue(projectId, due, now, callOptions(this.logger, options));
    for (const [url, node] of fresh) results.set(url, node);
    return results;
  }

  /** Refresh due links grouped by provider and file, files in parallel (bounded). */
  private async refreshDue(
    projectId: string,
    due: Due[],
    now: Date,
    call: DesignCallOptions,
  ): Promise<Map<string, DesignNode>> {
    const byFile = [
      ...Map.groupBy(due, (item) => `${item.provider.metadata.kind}\u0000${item.ref.fileKey}`),
    ];
    const batches = await mapLimit(byFile, FILE_CONCURRENCY, async ([, items]) => {
      return await this.refreshFile(projectId, items, now, call);
    });
    const merged = new Map<string, DesignNode>();
    for (const batch of batches) {
      for (const [url, node] of batch) merged.set(url, node);
    }
    return merged;
  }

  private async refreshFile(
    projectId: string,
    items: Due[],
    now: Date,
    call: DesignCallOptions,
  ): Promise<Map<string, DesignNode>> {
    const client = await this.clientFor(projectId, items);
    const first = items[0];
    if (!client || !first) return new Map();
    const { provider, ref } = first;
    const metas = await client.fetchMetas(
      ref.fileKey,
      items.map((item) => item.ref),
      call,
    );
    const answered = [...metas.values()].find((meta) => meta.state !== "error");
    if (answered && first.scope === PROJECT_SCOPE) {
      await this.credentials.recordStatus(
        projectId,
        provider.metadata.kind,
        statusFor(answered.state),
      );
    }
    const stored = await this.storeAll(projectId, items, metas, now);
    return await this.renders.ensure(projectId, client, ref.fileKey, stored, call);
  }

  /** Upsert a row per item that got a usable answer (`error` keeps its cached row), keyed by URL. */
  private async storeAll(
    projectId: string,
    items: Due[],
    metas: Map<string, DesignMeta>,
    now: Date,
  ): Promise<Map<string, DesignNode>> {
    const rows = await Promise.all(
      items.map(async (item) => {
        const meta = metas.get(item.ref.nodeId ?? "");
        const row =
          meta && meta.state !== "error" ? await this.store(projectId, item, meta, now) : null;
        return row ? ([item.url, row] as const) : null;
      }),
    );
    return new Map(rows.filter((entry) => entry !== null));
  }

  /** A client for the provider of `items` bound to the items' credential scope, or null without one. */
  private async clientFor(projectId: string, items: Due[]): Promise<DesignClient | null> {
    const first = items[0];
    if (!first) return null;
    const { provider, scope } = first;
    const kind = provider.metadata.kind;
    const own = scope !== PROJECT_SCOPE;
    const credential = own
      ? await this.connections?.accessToken(scope, kind, provider.oauth).catch(() => null)
      : await this.credentials.get(projectId, kind).catch(() => null);
    if (!credential) return null;
    return provider.create({
      credential,
      authType: own ? "oauth" : "token",
      ...(this.logger ? { logger: this.logger } : {}),
    });
  }

  /**
   * Whose credential serves a provider: the project's when set (it is shared and
   * wins), else the viewer's own connection, else the project scope (nothing to fetch with).
   */
  private async scopeFor(projectId: string, provider: string, viewerId?: string): Promise<string> {
    if (!viewerId || !this.connections || (await this.credentials.info(projectId, provider))) {
      return PROJECT_SCOPE;
    }
    return (await this.connections.info(viewerId, provider)) ? viewerId : PROJECT_SCOPE;
  }

  /** The shared row, else the viewer's own (a connected member's entries are never served to others). */
  private async visible(
    projectId: string,
    provider: string,
    ref: DesignRef,
    viewerId?: string,
  ): Promise<DesignNode | null> {
    const shared = await this.lookup(projectId, provider, ref, PROJECT_SCOPE);
    if (shared || !viewerId) return shared;
    return await this.lookup(projectId, provider, ref, viewerId);
  }

  private async lookup(
    projectId: string,
    provider: string,
    ref: DesignRef,
    scope: string,
  ): Promise<DesignNode | null> {
    const columns = getTableColumns(this.tables.designNodes);
    const column = (name: string): SQLWrapper => columns[name] as unknown as SQLWrapper;
    const rows = (await this.db.list(this.tables.designNodes, {
      where: and(
        eq(column("projectId"), projectId),
        eq(column("provider"), provider),
        eq(column("viewerId"), scope),
        eq(column("fileKey"), ref.fileKey),
        eq(column("nodeId"), ref.nodeId ?? ""),
      ),
      limit: 1,
    })) as unknown as DesignNode[];
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
    meta: DesignMeta,
    now: Date,
  ): Promise<DesignNode> {
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
      return (await this.db.insert(this.tables.designNodes, {
        id: ulid(),
        projectId,
        provider: item.provider.metadata.kind,
        viewerId: item.scope,
        fileKey: ref.fileKey,
        nodeId: ref.nodeId ?? "",
        renderPath: null,
        renderVersion: null,
        createdAt: stamp,
        ...values,
      })) as unknown as DesignNode;
    }
    const dropRender = meta.state === "deleted" && cached.renderPath !== null;
    if (dropRender) await this.renders.remove(cached);
    return (await this.db.update(this.tables.designNodes, cached.id, {
      ...values,
      ...(dropRender ? { renderPath: null, renderVersion: null } : {}),
    })) as unknown as DesignNode;
  }
}

/** Never fetched, or cached longer ago than the TTL. */
function isDue(cached: DesignNode | null, now: Date): boolean {
  return !cached || now.getTime() - Date.parse(cached.fetchedAt) >= DESIGN_TTL_MS;
}

function callOptions(logger: Logger | undefined, options: RefreshOptions): DesignCallOptions {
  return {
    ...(logger ? { logger } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

function statusFor(state: DesignMeta["state"]): DesignCredentialStatus {
  return state === "unauthorized" || state === "forbidden" ? state : "ok";
}

/** Run `load` once per key, sharing the in-flight promise between concurrent callers. */
async function memo<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit) return await hit;
  const created = load();
  cache.set(key, created);
  return await created;
}
