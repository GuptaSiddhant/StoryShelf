import { createClient } from "../client.ts";
import { printLine } from "../output.ts";

interface BuildResponse { id: string; }

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
  const client = createClient(options.url);
  const build = await client.projects.builds.retry(options.slug, options.buildId);
  const buildData = build as BuildResponse;
  printLine(`Build ${buildData.id} queued for retry`);
}
