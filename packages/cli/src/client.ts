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
  onProgress?: (loaded: number, total: number) => void,
): Promise<TData> {
  onProgress?.(1, 1);
  const response = await fetch(url, { method: "POST", headers, body: form });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as TData;
}
