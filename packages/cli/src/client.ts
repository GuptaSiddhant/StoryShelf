/**
 * Create a typed API client for a StoryShelf server.
 *
 * Wraps `fetch` with bearer auth and JSON helpers so commands can call
 * `client.projects.builds.createJson(...)` without hand-rolling URLs or headers.
 *
 * @param serverUrl - Server URL, e.g. `https://shelf.example.com`; trailing slashes are dropped and
 *   a path prefix (`https://host/shelf`) is kept
 * @param token - Optional bearer token (CI or admin token); sent as `Authorization: Bearer <token>`
 * @returns Namespaced client with `projects`, `builds` and `tokens` helpers
 */
export function createClient(serverUrl: string, token?: string): Client {
  const baseUrl = normalizeBaseUrl(serverUrl);
  const authHeaders = buildAuthHeaders(token);
  const requestHeaders = (contentType?: string): Record<string, string> =>
    buildRequestHeaders(authHeaders, contentType);

  return {
    health: async () => (await fetchJson(`${baseUrl}/api/v1/health`, {})) as ServerHealth,
    projects: createProjectsApi(baseUrl, authHeaders, requestHeaders),
  };
}

/**
 * The message of an error body. A current server answers `{ error: { message } }`; an older one
 * answered plain text, which is shown as it is, as is any JSON of another shape.
 */
export function apiErrorText(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } } | null;
    const message = parsed?.error?.message;
    return typeof message === "string" && message !== "" ? message : body;
  } catch {
    return body;
  }
}

/** A non-2xx answer from the server; `status` is the HTTP status. */
export class RequestError extends Error {
  override readonly name = "RequestError";
  readonly status: number;
  /** The server's `Retry-After`, in milliseconds, when it sent a valid one. */
  readonly retryAfterMs?: number;

  constructor(status: number, body: string, retryAfterMs?: number) {
    super(`Request failed (${status}): ${body}`);
    this.status = status;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

/** One stored file of a file-by-file upload. */
export interface ManifestFile {
  rel: string;
  hash: string;
  size: number;
}

/** Metadata posted to create a build before streaming its bundle. */
export interface BuildCreateInput {
  gitSha: string;
  gitBranch: string;
  message?: string;
  authorEmail?: string;
  authorName?: string;
  affectedOnly?: boolean;
  labels?: { key: string; value: string }[];
  /** Older in-flight builds this one replaces (ADR 0045); the server decides. */
  supersedes?: string[];
}

/** Affected-capture computation posted after build creation. */
export interface AffectedInput {
  baselineSha: string | null;
  changedFiles: string[];
  affectedImportPaths: string[] | null;
}

/** The build a commit that changed no story may repeat (`GET …/builds/skip-source`, ADR 0044). */
export interface SkipSource {
  sourceBuildId: string;
  sha: string;
}

/** Body of `POST …/builds/skipped`. */
export interface SkippedBuildInput {
  gitSha: string;
  gitBranch: string;
  sourceBuildId: string;
  changedFiles: string[];
  /** Every entry id of the new Storybook index; the server answers 409 unless they equal the source's. */
  entryIds: string[];
  /** Generated once per run; a retry with the same key returns the build the first call created. */
  idempotencyKey: string;
  labels?: { key: string; value: string }[];
  message?: string;
  author?: { email?: string; name?: string };
}

/** Answer of `POST …/builds/skipped`. */
export interface SkippedBuildCreated {
  build: { id: string };
  buildUrl: string;
}

/** One story-to-package usage row posted after build creation. */
export interface PackageUsageInput {
  storyImportPath: string;
  packageName: string;
  modulePath: string;
  version: string | null;
}

/** Build record plus the zip upload URL returned by JSON creation. */
export interface BuildCreated {
  build: { id: string };
  uploadUrl: string;
  /** Path of the build page; absent on servers that predate the field. */
  buildUrl?: string;
  baselineSha?: string | null;
  /** False when the server has no `testing` option; absent on servers that predate the field. */
  testing?: boolean;
}

/** The parts of `GET …/builds/:buildId` that `upload --wait` reads; the server adds the last two (ADR 0053). */
export interface BuildState {
  id: string;
  status: string;
  changedCount: number;
  /** JSON array of the build's Storybook test results; null when none ran. */
  testResults?: string | null;
  /** The newer build that replaced this one, when it was cancelled as superseded (ADR 0045). */
  supersededByBuildId?: string | null;
  /** Absent on servers that predate the field. */
  publishing?: "pending" | "success" | "failure" | "unavailable";
  /** Stories with a snapshot over the catalog's stories; null when nothing captures; absent on older servers. */
  capture?: { done: number; total: number | null } | null;
}

/** The absolute build page URL: the server URL joined to `buildUrl`, or `null` without both. */
export function buildPageUrl(
  serverUrl: string | undefined,
  buildUrl: string | undefined,
): string | null {
  if (serverUrl === undefined || buildUrl === undefined || !buildUrl.startsWith("/")) return null;
  return `${normalizeBaseUrl(serverUrl)}${buildUrl}`;
}

/** The line that ends an upload: the build page link, else the build id (older servers). */
export function describeBuildLink(
  serverUrl: string | undefined,
  build: { id: string },
  buildUrl: string | undefined,
): string {
  const link = buildPageUrl(serverUrl, buildUrl);
  return link === null ? `Build created: ${build.id}` : `View the build: ${link}`;
}

/** The open liveness answer of `GET /api/v1/health`; fields newer than the server are absent. */
export interface ServerHealth {
  /** Whether the server has sign-in; false means development mode, where every operation is permitted. */
  auth?: boolean;
  testing?: boolean;
  version?: string;
}

interface Client {
  /** Probe the server's open health endpoint (no token needed). */
  health: () => Promise<ServerHealth>;
  projects: {
    create: (json: {
      name: string;
      gitRepository?: string;
      gitDefaultBranch?: string;
      storybookMeta?: unknown;
    }) => Promise<unknown>;
    update: (slug: string, json: { storybookMeta?: unknown }) => Promise<unknown>;
    get: (slug: string) => Promise<unknown>;
    list: () => Promise<unknown>;
    tokens: {
      create: (slug: string, json: { name: string }) => Promise<unknown>;
    };
    builds: {
      createJson: (slug: string, json: BuildCreateInput) => Promise<BuildCreated>;
      /** The build row with its publishing and capture state: what `upload --wait` polls. */
      get: (slug: string, buildId: string) => Promise<BuildState>;
      /** The branch's builds still working, as `{ id, sha }` (404 on an old server or testing off). */
      inFlight: (slug: string, branch: string) => Promise<{ id: string; sha: string }[]>;
      uploadZip: (uploadUrl: string, body: NodeJS.ReadableStream) => Promise<unknown>;
      /** File-by-file upload, step 1: which of these content hashes the server lacks. */
      dedup: (slug: string, buildId: string, hashes: string[]) => Promise<string[]>;
      /** File-by-file upload, step 2: store files by content hash. */
      uploadContent: (
        slug: string,
        buildId: string,
        files: { hash: string; data: Buffer }[],
      ) => Promise<unknown>;
      /** File-by-file upload, step 3: store the path-to-hash manifest (completes publishing). */
      postManifest: (slug: string, buildId: string, files: ManifestFile[]) => Promise<unknown>;
      postAffected: (slug: string, buildId: string, json: AffectedInput) => Promise<unknown>;
      postUsage: (slug: string, buildId: string, usage: PackageUsageInput[]) => Promise<unknown>;
      retry: (slug: string, buildId: string) => Promise<unknown>;
      /** Cancel older unfinished builds (`dryRun` only lists them). */
      cancelOlder: (slug: string, json: CancelOlderInput) => Promise<CancelOlderResult>;
      /** The build a skip on `branch` for `sha` would repeat, or null (a hint, never a promise). */
      skipSource: (slug: string, branch: string, sha: string) => Promise<SkipSource | null>;
      /** Record a commit that changed no story; a `409` (`RequestError`) means upload normally. */
      createSkipped: (slug: string, json: SkippedBuildInput) => Promise<SkippedBuildCreated>;
    };
  };
}

/** Body of `POST …/builds/cancel`. */
export interface CancelOlderInput {
  branch?: string;
  keepNewest?: number;
  dryRun?: boolean;
}

/** Answer of `POST …/builds/cancel`: the cancelled IDs (or those a dry run would cancel). */
export interface CancelOlderResult {
  cancelled: string[];
  count: number;
  dryRun: boolean;
}

function buildAuthHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildRequestHeaders(
  authHeaders: Record<string, string>,
  contentType?: string,
): Record<string, string> {
  const headers: Record<string, string> = { ...authHeaders };
  if (contentType) {
    headers["content-type"] = contentType;
  }
  return headers;
}

async function fetchJson(url: string, options: RequestInit): Promise<unknown> {
  return await readJson(url, await fetch(url, options));
}

/**
 * The JSON body of a response. A failed status throws a `RequestError` that keeps the status; an
 * HTML page there (a proxy or login page) or in place of the JSON is described by `notJsonMessage`
 * instead of its markup or a parse error.
 */
async function readJson(url: string, res: Response): Promise<unknown> {
  const contentType = res.headers?.get("content-type") ?? "";
  if (!res.ok) {
    throw await failedRequest(url, res, contentType);
  }
  try {
    return (await res.json()) as unknown;
  } catch (error) {
    // Only a body that is not JSON gets the url hint; a dropped connection keeps its own error.
    throw error instanceof SyntaxError
      ? new Error(notJsonMessage(url, contentType), { cause: error })
      : error;
  }
}

/** `Retry-After` in milliseconds: a count of seconds (an HTTP date is not honoured), else undefined. */
function retryAfterOf(res: Response): number | undefined {
  const seconds = Number(res.headers?.get("retry-after"));
  return Number.isFinite(seconds) && seconds >= 0 && res.headers?.get("retry-after") !== null
    ? seconds * 1000
    : undefined;
}

/** The error for a failed status: an HTML page is described, not read, and its body released. */
async function failedRequest(
  url: string,
  res: Response,
  contentType: string,
): Promise<RequestError> {
  const retryAfterMs = retryAfterOf(res);
  if (!/html/iu.test(contentType)) {
    return new RequestError(res.status, apiErrorText(await res.text()), retryAfterMs);
  }
  await res.body?.cancel().catch(() => {});
  return new RequestError(res.status, notJsonMessage(url, contentType), retryAfterMs);
}

/** What to tell the user when a JSON endpoint answered with something else (origin only, no path). */
function notJsonMessage(url: string, contentType: string): string {
  const origin = URL.canParse(url) ? new URL(url).origin : "[invalid url]";
  const answered = /html/iu.test(contentType)
    ? "an HTML page, not JSON"
    : `a response that is not JSON${contentType ? ` (${contentType})` : ""}`;
  return `The server at ${origin} answered with ${answered}. Check the url (a wrong path, or a reverse proxy or login page in front of StoryShelf?)`;
}

function createTokensApi(
  baseUrl: string,
  requestHeaders: (contentType?: string) => Record<string, string>,
): Client["projects"]["tokens"] {
  return {
    create: async (slug: string, json: { name: string }) =>
      await fetchJson(`${baseUrl}/api/v1/projects/${slug}/tokens`, {
        method: "POST",
        headers: requestHeaders("application/json"),
        body: JSON.stringify(json),
      }),
  };
}

/** The three calls of a file-by-file upload. */
function createFileUploadApi(
  baseUrl: string,
  requestHeaders: (contentType?: string) => Record<string, string>,
): Pick<Client["projects"]["builds"], "dedup" | "uploadContent" | "postManifest"> {
  return {
    dedup: async (slug: string, buildId: string, hashes: string[]) => {
      const answer = (await fetchJson(
        `${baseUrl}/api/v1/projects/${slug}/builds/${buildId}/dedup`,
        {
          method: "POST",
          headers: requestHeaders("application/json"),
          body: JSON.stringify({ hashes }),
        },
      )) as { needed: string[] };
      return answer.needed;
    },
    uploadContent: async (
      slug: string,
      buildId: string,
      files: { hash: string; data: Buffer }[],
    ) => {
      const form = new FormData();
      for (const file of files) {
        form.set(file.hash, new File([new Uint8Array(file.data)], file.hash));
      }
      // No content-type header: fetch adds the multipart boundary itself.
      return await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds/${buildId}/content`, {
        method: "POST",
        headers: requestHeaders(),
        body: form,
      });
    },
    postManifest: async (slug: string, buildId: string, files: ManifestFile[]) =>
      await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds/${buildId}/manifest`, {
        method: "POST",
        headers: requestHeaders("application/json"),
        body: JSON.stringify({ files }),
      }),
  };
}

/** An answer that is not a list (an unexpected server) counts as no in-flight builds. */
function toInFlight(answer: unknown): { id: string; sha: string }[] {
  return Array.isArray(answer) ? (answer as { id: string; sha: string }[]) : [];
}

/** The two skip calls (ADR 0044): the hint, then the creation of the skipped build. */
function createSkipApi(
  baseUrl: string,
  requestHeaders: (contentType?: string) => Record<string, string>,
): Pick<Client["projects"]["builds"], "skipSource" | "createSkipped"> {
  return {
    skipSource: async (slug: string, branch: string, sha: string) =>
      (await fetchJson(
        `${baseUrl}/api/v1/projects/${slug}/builds/skip-source?${new URLSearchParams({ branch, sha }).toString()}`,
        { method: "GET", headers: requestHeaders() },
      )) as SkipSource | null,
    createSkipped: async (slug: string, json: SkippedBuildInput) =>
      (await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds/skipped`, {
        method: "POST",
        headers: requestHeaders("application/json"),
        body: JSON.stringify(json),
      })) as SkippedBuildCreated,
  };
}

/** The in-flight lookup behind superseded-build detection (ADR 0045). */
function createInFlightApi(
  baseUrl: string,
  requestHeaders: (contentType?: string) => Record<string, string>,
): Pick<Client["projects"]["builds"], "inFlight"> {
  return {
    inFlight: async (slug: string, branch: string) =>
      toInFlight(
        await fetchJson(
          `${baseUrl}/api/v1/projects/${slug}/builds/in-flight?branch=${encodeURIComponent(branch)}`,
          { headers: requestHeaders() },
        ),
      ),
  };
}

function cancelOlderApi(
  baseUrl: string,
  requestHeaders: (contentType?: string) => Record<string, string>,
): (slug: string, json: CancelOlderInput) => Promise<CancelOlderResult> {
  return async (slug, json) =>
    (await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds/cancel`, {
      method: "POST",
      headers: requestHeaders("application/json"),
      body: JSON.stringify(json),
    })) as CancelOlderResult;
}

function createBuildsApi(
  baseUrl: string,
  authHeaders: Record<string, string>,
  requestHeaders: (contentType?: string) => Record<string, string>,
): Client["projects"]["builds"] {
  return {
    ...createFileUploadApi(baseUrl, requestHeaders),
    ...createSkipApi(baseUrl, requestHeaders),
    createJson: async (slug: string, json: BuildCreateInput) =>
      (await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds`, {
        method: "POST",
        headers: requestHeaders("application/json"),
        body: JSON.stringify(json),
      })) as BuildCreated,
    ...createInFlightApi(baseUrl, requestHeaders),
    get: async (slug: string, buildId: string) =>
      (await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds/${encodeURIComponent(buildId)}`, {
        headers: requestHeaders(),
      })) as BuildState,
    uploadZip: async (uploadUrl: string, body: NodeJS.ReadableStream) => {
      const init = {
        method: "PUT",
        headers: { ...authHeaders, "content-type": "application/zip" },
        body: body as unknown as BodyInit,
        duplex: "half",
      } as RequestInit;
      const url = `${baseUrl}${uploadUrl}`;
      return await readJson(url, await fetch(url, init));
    },
    retry: async (slug: string, buildId: string) =>
      await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds/${buildId}/retry`, {
        method: "POST",
        headers: requestHeaders("application/json"),
        body: JSON.stringify({}),
      }),
    cancelOlder: cancelOlderApi(baseUrl, requestHeaders),
    postUsage: async (slug: string, buildId: string, usage: PackageUsageInput[]) =>
      await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds/${buildId}/usage`, {
        method: "POST",
        headers: requestHeaders("application/json"),
        body: JSON.stringify({ usage }),
      }),
    postAffected: async (slug: string, buildId: string, json: AffectedInput) =>
      await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds/${buildId}/affected`, {
        method: "POST",
        headers: requestHeaders("application/json"),
        body: JSON.stringify(json),
      }),
  };
}

function createProjectsApi(
  baseUrl: string,
  authHeaders: Record<string, string>,
  requestHeaders: (contentType?: string) => Record<string, string>,
): Client["projects"] {
  return {
    create: async (json: {
      name: string;
      gitRepository?: string;
      gitDefaultBranch?: string;
      storybookMeta?: unknown;
    }) =>
      await fetchJson(`${baseUrl}/api/v1/projects`, {
        method: "POST",
        headers: requestHeaders("application/json"),
        body: JSON.stringify(json),
      }),
    update: async (slug: string, json: { storybookMeta?: unknown }) =>
      await fetchJson(`${baseUrl}/api/v1/projects/${slug}`, {
        method: "PATCH",
        headers: requestHeaders("application/json"),
        body: JSON.stringify(json),
      }),
    get: async (slug: string) =>
      await fetchJson(`${baseUrl}/api/v1/projects/${slug}`, {
        headers: requestHeaders(),
      }),
    list: async () =>
      await fetchJson(`${baseUrl}/api/v1/projects`, {
        headers: requestHeaders(),
      }),
    tokens: createTokensApi(baseUrl, requestHeaders),
    builds: createBuildsApi(baseUrl, authHeaders, requestHeaders),
  };
}

/** Strip trailing slashes from a URL so `base + path` never doubles them; a path prefix stays. */
export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/u, "");
}

/**
 * POST JSON and parse the JSON response.
 *
 * @param url - Absolute request URL
 * @param body - Payload serialized as JSON
 * @param headers - Extra headers merged with `content-type: application/json`
 * @returns Parsed response body
 * @throws If the response is not `ok` (includes status and body text)
 */
export async function postJson<TData>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<TData> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${apiErrorText(await response.text())}`);
  }
  return (await response.json()) as TData;
}

/**
 * POST a `FormData` body and parse the JSON response.
 *
 * @param url - Absolute request URL
 * @param form - Multipart form payload
 * @param headers - Extra headers (e.g. auth)
 * @returns Parsed response body
 */
export async function postForm<TData>(
  url: string,
  form: FormData,
  headers: Record<string, string> = {},
): Promise<TData> {
  const response = await fetch(url, { method: "POST", headers, body: form });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${apiErrorText(await response.text())}`);
  }
  return (await response.json()) as TData;
}
