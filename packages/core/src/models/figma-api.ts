/** Figma REST client: batched metadata and render fetches with the project PAT, via the shared HTTP helper. */
import type { Buffer } from "node:buffer";
import type { Logger } from "../logger.ts";
import type { FigmaRef } from "../utils/figma-url.ts";
import { HttpError, httpBytes, httpJson, type HttpRequestOptions } from "../utils/http.ts";

const FIGMA_API = "https://api.figma.com/v1";
/**
 * Render scale: 2x keeps text legible next to retina screenshots without the
 * 4x payload; renders are reference-only, never diffed.
 */
const RENDER_SCALE = 2;

/** Outcome of a metadata fetch. `error` is transient (outage/rate limit), never persisted. */
export type FigmaState = "ok" | "deleted" | "unauthorized" | "forbidden" | "error";

/** Metadata of a Figma file or node. */
export interface FigmaMeta {
  state: FigmaState;
  name: string | null;
  version: string | null;
  lastModified: string | null;
}

/** Shared request options: logger plus a signal that cancels the whole call (page-render budget). */
export interface FigmaCallOptions {
  logger?: Logger;
  signal?: AbortSignal;
}

interface FileResponse {
  name?: string;
  version?: string;
  lastModified?: string;
}
interface NodesResponse extends FileResponse {
  nodes?: Record<string, { document?: { name?: string } } | null>;
}
interface ImagesResponse {
  images?: Record<string, string | null>;
}

const EMPTY = { name: null, version: null, lastModified: null } as const;

/** Key of a ref inside a per-file result map: the node id, or `""` for the whole file. */
export const refKey = (ref: Pick<FigmaRef, "nodeId">): string => ref.nodeId ?? "";

function requestOptions(
  token: string,
  timeoutMs: number,
  options: FigmaCallOptions,
): HttpRequestOptions {
  return {
    headers: { "X-Figma-Token": token },
    timeoutMs,
    // `retries` is the total attempt count (first try included), so 2 = one retry; the shared default is 3.
    retries: 2,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

/**
 * Fetch metadata for several refs of one file in at most two requests: one
 * `nodes?ids=a,b` call for every node ref and one depth-1 file call when the
 * whole file is linked. API failures map to a {@link FigmaState} per ref.
 */
export async function fetchFigmaMetas(
  token: string,
  fileKey: string,
  refs: readonly FigmaRef[],
  options: FigmaCallOptions = {},
): Promise<Map<string, FigmaMeta>> {
  const ids = [...new Set(refs.flatMap((ref) => (ref.nodeId ? [ref.nodeId] : [])))];
  const results = ids.length > 0 ? await fetchNodeMetas(token, fileKey, ids, options) : new Map();
  if (refs.some((ref) => !ref.nodeId)) {
    results.set("", await fetchFileMeta(token, fileKey, options));
  }
  return results;
}

/** One `nodes?ids=a,b` request answering for every node id. */
async function fetchNodeMetas(
  token: string,
  fileKey: string,
  ids: readonly string[],
  options: FigmaCallOptions,
): Promise<Map<string, FigmaMeta>> {
  const key = encodeURIComponent(fileKey);
  const url = `${FIGMA_API}/files/${key}/nodes?ids=${encodeURIComponent(ids.join(","))}&depth=1`;
  const outcome = await fetchOrFail<NodesResponse>(url, token, options);
  return new Map(ids.map((id) => [id, "meta" in outcome ? nodeMeta(outcome.meta, id) : outcome]));
}

async function fetchFileMeta(
  token: string,
  fileKey: string,
  options: FigmaCallOptions,
): Promise<FigmaMeta> {
  const url = `${FIGMA_API}/files/${encodeURIComponent(fileKey)}?depth=1`;
  const outcome = await fetchOrFail<FileResponse>(url, token, options);
  return "meta" in outcome ? fileMeta(outcome.meta) : outcome;
}

type Fetched<T> = { meta: T } | FigmaMeta;

async function fetchOrFail<T>(
  url: string,
  token: string,
  options: FigmaCallOptions,
): Promise<Fetched<T>> {
  try {
    return { meta: await httpJson<T>(url, requestOptions(token, 10_000, options)) };
  } catch (error) {
    return failureMeta(error);
  }
}

function fileMeta(body: FileResponse): FigmaMeta {
  return {
    state: "ok",
    name: body.name ?? null,
    version: body.version ?? null,
    lastModified: body.lastModified ?? null,
  };
}

function nodeMeta(body: NodesResponse, id: string): FigmaMeta {
  const base = { version: body.version ?? null, lastModified: body.lastModified ?? null };
  const node = body.nodes?.[id];
  if (!node) return { state: "deleted", name: null, ...base };
  return { state: "ok", name: node.document?.name ?? body.name ?? null, ...base };
}

function failureMeta(error: unknown): FigmaMeta {
  if (error instanceof HttpError) {
    if (error.status === 401) return { state: "unauthorized", ...EMPTY };
    if (error.status === 403) return { state: "forbidden", ...EMPTY };
    if (error.status === 404) return { state: "deleted", ...EMPTY };
  }
  return { state: "error", ...EMPTY };
}

/** Metadata of one file or node; a convenience over {@link fetchFigmaMetas}. */
export async function fetchFigmaMeta(
  token: string,
  ref: FigmaRef,
  options: FigmaCallOptions = {},
): Promise<FigmaMeta> {
  const metas = await fetchFigmaMetas(token, ref.fileKey, [ref], options);
  return metas.get(refKey(ref)) ?? { state: "error", ...EMPTY };
}

/**
 * Render several nodes of one file to PNG with a single Images API call, then
 * download each (Figma's signed URLs expire, so they are never hot-linked).
 * Nodes Figma has no render for, or whose download fails, are omitted.
 * Throws when the Images API call itself fails.
 */
export async function fetchFigmaRenders(
  token: string,
  fileKey: string,
  nodeIds: readonly string[],
  options: FigmaCallOptions = {},
): Promise<Map<string, Buffer>> {
  if (nodeIds.length === 0) return new Map();
  const ids = encodeURIComponent(nodeIds.join(","));
  const body = await httpJson<ImagesResponse>(
    `${FIGMA_API}/images/${encodeURIComponent(fileKey)}?ids=${ids}&format=png&scale=${RENDER_SCALE}`,
    requestOptions(token, 15_000, options),
  );
  const downloaded = await Promise.all(
    nodeIds.map(async (id) => {
      const url = body.images?.[id];
      return url ? ([id, await download(url, options)] as const) : null;
    }),
  );
  return new Map(downloaded.filter((entry) => entry !== null));
}

async function download(url: string, options: FigmaCallOptions): Promise<Buffer> {
  const { headers: _headers, ...rest } = requestOptions("", 30_000, options);
  return await httpBytes(url, rest);
}

/** Render of one node; null for whole-file refs and nodes Figma cannot render. Throws on API/download failure. */
export async function fetchFigmaRender(
  token: string,
  ref: FigmaRef,
  options: FigmaCallOptions = {},
): Promise<Buffer | null> {
  if (!ref.nodeId) return null;
  const renders = await fetchFigmaRenders(token, ref.fileKey, [ref.nodeId], options);
  return renders.get(ref.nodeId) ?? null;
}
