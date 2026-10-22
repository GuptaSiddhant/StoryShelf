/** Shared shapes of the `protect` command's host adapters. */

/** `fetch`, injectable so tests record the host API instead of calling it. */
export type Fetch = typeof fetch;

/** What the rule must require. */
export interface ProtectionTarget {
  branch: string;
  /** Check names (commit status contexts or check-run names). */
  checks: string[];
}

/** What validating a branch's rule found. */
export interface ProtectionResult {
  /** One or two lines: what is in place and what is missing. */
  summary: string;
  satisfied: boolean;
  /** Writes the missing part and says what it did; absent when the rule cannot be written automatically. */
  apply?: () => Promise<string>;
}

/** One host's branch-protection API. */
export interface ProtectionAdapter {
  /** Env var that carries the admin token. */
  tokenEnv: string;
  /** The steps to do by hand, printed in every run. */
  manualSteps(target: ProtectionTarget): string[];
  /** Read the rule (no writes). */
  inspect(target: ProtectionTarget, token: string): Promise<ProtectionResult>;
}

/** An HTTP failure of a host API call, with the status for callers that branch on 404. */
export class HostError extends Error {
  override readonly name = "HostError";
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Call a host API and parse its JSON; a non-2xx answer throws {@link HostError} (the token is never in the text). */
export async function hostJson<T>(
  fetchImpl: Fetch,
  url: string,
  init: { method?: string; headers: Record<string, string>; json?: unknown },
): Promise<T> {
  const response = await fetchImpl(url, {
    method: init.method ?? "GET",
    headers:
      init.json === undefined
        ? init.headers
        : { ...init.headers, "content-type": "application/json" },
    ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new HostError(
      response.status,
      `${String(response.status)} from ${new URL(url).pathname}: ${text.slice(0, 200)}`,
    );
  }
  return (text === "" ? {} : JSON.parse(text)) as T;
}
