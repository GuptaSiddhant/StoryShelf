import { normalizeBaseUrl, postJson } from "../client.ts";
import { printLine } from "../output.ts";

interface BuildResponse {
  id: string;
}

/** Options for the `retry` command. */
export interface RetryOptions {
  /** Server base URL. */
  url: string;
  /** Project slug. */
  slug: string;
  /** Build ID to retry. */
  buildId: string;
}

/**
 * Retry a failed StoryShelf build.
 *
 * @param options - Retry command options.
 */
export async function runRetry(options: RetryOptions): Promise<void> {
  const base = normalizeBaseUrl(options.url);
  const build = await postJson<BuildResponse>(
    `${base}/api/v1/projects/${options.slug}/builds/${options.buildId}/retry`,
    {},
  );
  printLine(`Build ${build.id} queued for retry`);
}
