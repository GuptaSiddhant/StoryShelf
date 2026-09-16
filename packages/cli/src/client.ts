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

/** Metadata posted to create a build before streaming its bundle. */
export interface BuildCreateInput {
  gitSha: string;
  gitBranch: string;
  message?: string;
  authorEmail?: string;
  authorName?: string;
  labels?: { key: string; value: string }[];
}

/** Build record plus the zip upload URL returned by JSON creation. */
export interface BuildCreated {
  build: { id: string };
  uploadUrl: string;
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
    throw new Error(`Request failed (${res.status}): ${await res.text()}`);
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

function createBuildsApi(
  baseUrl: string,
  authHeaders: Record<string, string>,
  requestHeaders: (contentType?: string) => Record<string, string>,
): Client["projects"]["builds"] {
  return {
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
        throw new Error(`Request failed (${res.status}): ${await res.text()}`);
      }
      return res.json() as unknown;
    },
    retry: async (slug: string, buildId: string) =>
      await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds/${buildId}/retry`, {
        method: "POST",
        headers: requestHeaders("application/json"),
        body: JSON.stringify({}),
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
