/** Figma metadata cache: API client (project PAT, shared `httpJson`), TTL refresh, and stale detection. */
import { and, eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Logger } from "../logger.ts";
import type { FigmaNode } from "../schema/design.ts";
import { parseFigmaUrl, type FigmaRef } from "../utils/figma-url.ts";
import { HttpError, httpJson } from "../utils/http.ts";
import { ulid } from "../utils/ulid.ts";
import type { DesignModel, DesignTokenStatus } from "./design.ts";

const FIGMA_API = "https://api.figma.com/v1";
/** Cached metadata younger than this is served without a refetch. */
export const FIGMA_TTL_MS = 15 * 60_000;
/** Figma personal access tokens expire after at most 90 days. */
export const FIGMA_TOKEN_MAX_AGE_DAYS = 90;

/** Outcome of a metadata fetch. `error` is transient (outage/rate limit) and never replaces good cache. */
export type FigmaState = "ok" | "deleted" | "unauthorized" | "forbidden" | "error";

/** Metadata of a Figma file or node. */
export interface FigmaMeta {
  state: FigmaState;
  name: string | null;
  version: string | null;
  lastModified: string | null;
}

interface FileResponse {
  name?: string;
  version?: string;
  lastModified?: string;
}
interface NodesResponse extends FileResponse {
  nodes?: Record<string, { document?: { name?: string } } | null>;
}

/** Fetch metadata for a file (depth-1) or a single node; maps API failures to a {@link FigmaState}. */
export async function fetchFigmaMeta(
  token: string,
  ref: FigmaRef,
  logger?: Logger,
): Promise<FigmaMeta> {
  const key = encodeURIComponent(ref.fileKey);
  const url = ref.nodeId
    ? `${FIGMA_API}/files/${key}/nodes?ids=${encodeURIComponent(ref.nodeId)}&depth=1`
    : `${FIGMA_API}/files/${key}?depth=1`;
  try {
    const body = await httpJson<NodesResponse>(url, {
      headers: { "X-Figma-Token": token },
      timeoutMs: 10_000,
      retries: 2,
      ...(logger ? { logger } : {}),
    });
    return metaFrom(body, ref);
  } catch (error) {
    return failureMeta(error);
  }
}

function metaFrom(body: NodesResponse, ref: FigmaRef): FigmaMeta {
  const base = { version: body.version ?? null, lastModified: body.lastModified ?? null };
  if (ref.nodeId) {
    const node = body.nodes?.[ref.nodeId];
    if (!node) return { state: "deleted", name: null, ...base };
    return { state: "ok", name: node.document?.name ?? body.name ?? null, ...base };
  }
  return { state: "ok", name: body.name ?? null, ...base };
}

function failureMeta(err: unknown): FigmaMeta {
  const empty = { name: null, version: null, lastModified: null };
  if (err instanceof HttpError) {
    if (err.status === 401) return { state: "unauthorized", ...empty };
    if (err.status === 403) return { state: "forbidden", ...empty };
    if (err.status === 404) return { state: "deleted", ...empty };
  }
  return { state: "error", ...empty };
}

/** True when the design changed after the baseline it is compared with was approved. */
export function isDesignStale(
  node: Pick<FigmaNode, "state" | "lastModified"> | null | undefined,
  baselineVersion: string | null | undefined,
): boolean {
  if (node?.state !== "ok" || !node.lastModified || !baselineVersion) return false;
  const modified = Date.parse(node.lastModified);
  const approved = Date.parse(baselineVersion);
  return Number.isFinite(modified) && Number.isFinite(approved) && modified > approved;
}

/** Days until the project's token passes the 90-day cap (negative once past), from its last update. */
export function tokenDaysLeft(updatedAt: string, now: Date = new Date()): number {
  const ageDays = (now.getTime() - Date.parse(updatedAt)) / 86_400_000;
  return Math.ceil(FIGMA_TOKEN_MAX_AGE_DAYS - ageDays);
}

/** Tables required by {@link FigmaNodeModel}. */
export interface FigmaNodeTables {
  figmaNodes: Table;
}

/** Cache of Figma file/node metadata with TTL refresh. */
export class FigmaNodeModel {
  private readonly tables: FigmaNodeTables;
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly design: DesignModel,
    tables?: FigmaNodeTables,
    private readonly logger?: Logger,
  ) {
    this.tables = tables ?? { figmaNodes: db.tables.figmaNodes };
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

  /**
   * Refresh a link's metadata when missing or past the TTL. Transient failures
   * keep the previous cache; auth failures update the token's health. Never throws.
   */
  async refresh(projectId: string, url: string, now: Date = new Date()): Promise<FigmaNode | null> {
    const ref = parseFigmaUrl(url);
    if (!ref) return null;
    const cached = await this.lookup(projectId, ref);
    if (cached && now.getTime() - Date.parse(cached.fetchedAt) < FIGMA_TTL_MS) return cached;
    const token = await this.design.getToken(projectId).catch(() => null);
    if (!token) return cached;
    const meta = await fetchFigmaMeta(token, ref, this.logger);
    if (meta.state === "error") return cached;
    await this.design.recordTokenStatus(projectId, tokenStatusFor(meta.state));
    return await this.store(projectId, ref, meta, cached, now);
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

  private async store(
    projectId: string,
    ref: FigmaRef,
    meta: FigmaMeta,
    existing: FigmaNode | null,
    now: Date,
  ): Promise<FigmaNode> {
    const stamp = now.toISOString();
    const values = {
      name: meta.name,
      version: meta.version,
      lastModified: meta.lastModified,
      state: meta.state,
      fetchedAt: stamp,
      updatedAt: stamp,
    };
    if (existing) {
      return (await this.db.update(
        this.tables.figmaNodes,
        existing.id,
        values,
      )) as unknown as FigmaNode;
    }
    return (await this.db.insert(this.tables.figmaNodes, {
      id: ulid(),
      projectId,
      fileKey: ref.fileKey,
      nodeId: ref.nodeId ?? "",
      createdAt: stamp,
      ...values,
    })) as unknown as FigmaNode;
  }
}

function tokenStatusFor(state: FigmaState): DesignTokenStatus {
  if (state === "unauthorized" || state === "forbidden") return state;
  return "ok";
}
