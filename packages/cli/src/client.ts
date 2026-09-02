interface Client {
  projects: {
    create: (json: { name: string; gitRepository?: string; gitDefaultBranch?: string; storybookMeta?: unknown }) => Promise<unknown>;
    update: (slug: string, json: { storybookMeta?: unknown }) => Promise<unknown>;
    get: (slug: string) => Promise<unknown>;
    list: () => Promise<unknown>;
    tokens: {
      create: (slug: string, json: { name: string }) => Promise<unknown>;
    };
    builds: {
      create: (slug: string, form: FormData) => Promise<unknown>;
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

function buildRequestHeaders(authHeaders: Record<string, string>, contentType?: string): Record<string, string> {
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
    create: async (slug: string, form: FormData) =>
      await fetchJson(`${baseUrl}/api/v1/projects/${slug}/builds`, {
        method: "POST",
        headers: authHeaders,
        body: form,
      }),
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
    create: async (json: { name: string; gitRepository?: string; gitDefaultBranch?: string; storybookMeta?: unknown }) =>
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

export function createClient(baseUrl: string, token?: string): Client {
  const authHeaders = buildAuthHeaders(token);
  const requestHeaders = (contentType?: string): Record<string, string> => buildRequestHeaders(authHeaders, contentType);

  return {
    projects: createProjectsApi(baseUrl, authHeaders, requestHeaders),
  };
}

// Re-export old helpers for backward compatibility with tests
export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/u, "");
}

export async function postJson<TData>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<TData> {
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

export async function postForm<TData>(url: string, form: FormData, headers: Record<string, string> = {}): Promise<TData> {
  const response = await fetch(url, { method: "POST", headers, body: form });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as TData;
}

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
