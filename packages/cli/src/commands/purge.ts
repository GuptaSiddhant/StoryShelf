import { normalizeBaseUrl, postJson } from "../client.ts";
import { printLine } from "../output.ts";

interface PurgeResponse {
  removedBuilds: number;
}

/** Options for the `purge` command. */
export interface PurgeOptions {
  /** Server base URL. */
  url: string;
}

/**
 * Purge expired builds on a StoryShelf server.
 *
 * @param options - Purge command options.
 */
export async function runPurge(options: PurgeOptions): Promise<void> {
  const base = normalizeBaseUrl(options.url);
  const result = await postJson<PurgeResponse>(`${base}/api/v1/admin/purge`, {});
  printLine(`Removed ${result.removedBuilds} build(s)`);
}
