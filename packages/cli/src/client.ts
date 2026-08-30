interface Client {
  projects: {
    create: (json: { name: string; gitRepository?: string; gitDefaultBranch?: string }) => Promise<unknown>;
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

export function createClient(baseUrl: string, token?: string): Client {
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  
  function requestHeaders(contentType?: string): Record<string, string> {
    const h: Record<string, string> = { ...authHeaders };
    if (contentType) h["content-type"] = contentType;
    return h;
  }
  
  return {
    projects: {
      create: async (json: { name: string; gitRepository?: string; gitDefaultBranch?: string }) => {
        const res = await fetch(`${baseUrl}/api/v1/projects`, {
          method: "POST",
          headers: requestHeaders("application/json"),
          body: JSON.stringify(json),
        });
        if (!res.ok) throw new Error(`Request failed (${res.status}): ${await res.text()}`);
        return res.json() as unknown;
      },
      get: async (slug: string) => {
        const res = await fetch(`${baseUrl}/api/v1/projects/${slug}`, { headers: requestHeaders() });
        if (!res.ok) throw new Error(`Request failed (${res.status}): ${await res.text()}`);
        return res.json() as unknown;
      },
      list: async () => {
        const res = await fetch(`${baseUrl}/api/v1/projects`, { headers: requestHeaders() });
        if (!res.ok) throw new Error(`Request failed (${res.status}): ${await res.text()}`);
        return res.json() as unknown;
      },
      tokens: {
        create: async (slug: string, json: { name: string }) => {
          const res = await fetch(`${baseUrl}/api/v1/projects/${slug}/tokens`, {
            method: "POST",
            headers: requestHeaders("application/json"),
            body: JSON.stringify(json),
          });
          if (!res.ok) throw new Error(`Request failed (${res.status}): ${await res.text()}`);
          return res.json() as unknown;
        },
      },
      builds: {
        create: async (slug: string, form: FormData) => {
          const res = await fetch(`${baseUrl}/api/v1/projects/${slug}/builds`, {
            method: "POST",
            headers: authHeaders,
            body: form,
          });
          if (!res.ok) throw new Error(`Request failed (${res.status}): ${await res.text()}`);
          return res.json() as unknown;
        },
        retry: async (slug: string, buildId: string) => {
          const res = await fetch(`${baseUrl}/api/v1/projects/${slug}/builds/${buildId}/retry`, {
            method: "POST",
            headers: requestHeaders("application/json"),
            body: JSON.stringify({}),
          });
          if (!res.ok) throw new Error(`Request failed (${res.status}): ${await res.text()}`);
          return res.json() as unknown;
        },
      },
      admin: {
        purge: async (json: { ttlDays?: number }) => {
          const res = await fetch(`${baseUrl}/api/v1/admin/purge`, {
            method: "POST",
            headers: requestHeaders("application/json"),
            body: JSON.stringify(json),
          });
          if (!res.ok) throw new Error(`Request failed (${res.status}): ${await res.text()}`);
          return res.json() as unknown;
        },
      },
    },
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