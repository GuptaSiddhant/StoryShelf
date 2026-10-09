import { HttpError, httpJson } from "@storyshelf/core/utils";
import type { McpConfig } from "./config.ts";

/** Thin JSON client over the StoryShelf `/api/v1` surface (read + comment only). */
export interface ApiClient {
  /** Default project slug from config, if any. */
  readonly defaultSlug: string | undefined;
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  post<T>(path: string, json?: unknown): Promise<T>;
}

/** Error whose message is safe to show an agent (no secrets, actionable). */
export class ToolError extends Error {
  override name = "ToolError";
}

/** Build an {@link ApiClient} that sends the configured Bearer token on every call. */
export function createApiClient(config: McpConfig): ApiClient {
  const headers: Record<string, string> = config.token
    ? { authorization: `Bearer ${config.token}` }
    : {};
  const request = async <T>(
    method: string,
    path: string,
    json?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> => {
    try {
      return await httpJson<T>(`${config.url}/api/v1${path}${toQueryString(query)}`, {
        method,
        headers,
        ...(json === undefined ? {} : { json }),
      });
    } catch (error) {
      throw toToolError(error);
    }
  };
  return {
    defaultSlug: config.slug,
    get: async (path, query) => await request("GET", path, undefined, query),
    post: async (path, json) => await request("POST", path, json ?? {}),
  };
}

function toQueryString(query: Record<string, string | number | undefined> | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

const STATUS_HINTS: Record<number, string> = {
  401: "authentication failed: check STORYSHELF_TOKEN",
  403: "forbidden: this token's role does not allow that (comments need developer or above)",
  404: "not found: check the project slug and build id",
  409: "conflict: AI insights are disabled for this project",
  501: "AI is not configured on this StoryShelf server",
};

/** Map transport/HTTP failures to an agent-readable {@link ToolError}. */
export function toToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof HttpError) {
    const hint = STATUS_HINTS[error.status] ?? `request failed (${error.status})`;
    return new ToolError(`StoryShelf API: ${hint}`);
  }
  return new ToolError(
    `StoryShelf API unreachable: ${error instanceof Error ? error.message : String(error)}`,
  );
}
