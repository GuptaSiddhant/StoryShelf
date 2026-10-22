/**
 * Create a typed API client for a StoryShelf server.
 *
 * Wraps `fetch` with bearer auth and JSON helpers so commands can call
 * `client.projects.builds.createJson(...)` without hand-rolling URLs or headers.
 *
 * @param baseUrl - Server origin, e.g. `https://shelf.example.com`
 * @param token - Optional bearer token (CI or admin token); sent as `Authorization: Bearer <token>`
 * @returns Namespaced client with `projects`, `builds`, `tokens`, and `admin` helpers
 */
export function createClient(baseUrl: string, token?: string): Client {
  const authHeaders = buildAuthHeaders(token);
  const requestHeaders = (contentType?: string): Record<string, string> =>
    buildRequestHeaders(authHeaders, contentType);

  return {
    projects: createProjectsApi(baseUrl, authHeaders, requestHeaders),
  };
}

/** A non-2xx answer from the server; `status` is the HTTP status. */
export class RequestError extends Error {
  override readonly name = "RequestError";
  readonly status: number;

  constructor(status: number, body: string) {
    super(`Request failed (${status}): ${body}`);
    this.status = status;
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
}

/** Affected-capture computation posted after build creation. */
export interface AffectedInput {
  baselineSha: string | null;
  changedFiles: string[];
  affectedImportPaths: string[] | null;
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
  baselineSha?: string | null;
}

interface Client {
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
    };
    admin: {
      purge: (json: { ttlDays?: number }) => Promise<unknown>;
    };
  };
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
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new RequestError(res.status, await res.text());
  }
  return res.json() as unknown;
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

function createBuildsApi(
  baseUrl: string,
  authHeaders: Record<string, string>,
  requestHeaders: (contentType?: string) => Record<string, string>,
): Client["projects"]["builds"] {
  return {
    ...createFileUploadApi(baseUrl, requestHeaders),
    createJson: async (slug: string, json: BuildCreateInput) =>
      (await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds`, {
        method: "POST",
        headers: requestHeaders("application/json"),
        body: JSON.stringify(json),
      })) as BuildCreated,
    uploadZip: async (uploadUrl: string, body: NodeJS.ReadableStream) => {
      const init = {
        method: "PUT",
        headers: { ...authHeaders, "content-type": "application/zip" },
        body: body as unknown as BodyInit,
        duplex: "half",
      } as RequestInit;
      const res = await fetch(`${baseUrl}${uploadUrl}`, init);
      if (!res.ok) {
        throw new RequestError(res.status, await res.text());
      }
      return res.json() as unknown;
    },
    retry: async (slug: string, buildId: string) =>
      await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds/${buildId}/retry`, {
        method: "POST",
        headers: requestHeaders("application/json"),
        body: JSON.stringify({}),
      }),
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

function createAdminApi(
  baseUrl: string,
  requestHeaders: (contentType?: string) => Record<string, string>,
): Client["projects"]["admin"] {
  return {
    purge: async (json: { ttlDays?: number }) =>
      await fetchJson(`${baseUrl}/api/v1/admin/purge`, {
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
    admin: createAdminApi(baseUrl, requestHeaders),
  };
}

// Re-export old helpers for backward compatibility with tests
/** Strip trailing slashes from a URL so `base + path` never doubles them. */
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
    throw new Error(`Request failed (${response.status}): ${await response.text()}`);
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
    throw new Error(`Request failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as TData;
}

/**
 * POST a `FormData` body with future progress reporting and parse the JSON response.
 * Currently behaves like {@link postForm}; the name is kept for CLI compatibility
 * and to allow streaming progress hooks without a breaking change.
 *
 * @param url - Absolute request URL
 * @param form - Multipart form payload
 * @param headers - Extra headers (e -g - auth)
 * @returns Parsed response body
 */
export async function postFormWithProgress<TData>(
  url: string,
  form: FormData,
  headers: Record<string, string> = {},
): Promise<TData> {
  const response = await fetch(url, { method: "POST", headers, body: form });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as TData;
}
