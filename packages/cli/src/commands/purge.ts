import { createClient } from "../client.ts";
import { printLine } from "../output.ts";

interface PurgeResponse {
  removedBuilds: number;
  removedFiles: number;
}

/** Options for the `purge` command. */
export interface PurgeOptions {
  /** Server base URL. */
  url: string;
  /** Admin token (fallback to env). */
  token?: string;
}

/**
 * Purge expired builds on a StoryShelf server.
 *
 * @param options - Purge command options.
 */
export async function runPurge(options: PurgeOptions): Promise<void> {
  const token =
    options.token ?? process.env["STORYSHELF_ADMIN_TOKEN"] ?? process.env["ADMIN_TOKEN"];
  const client = createClient(options.url, token);
  const result = await client.projects.admin.purge({});
  const resultData = result as PurgeResponse;
  printLine(
    `Removed ${resultData.removedBuilds} build(s) and ${resultData.removedFiles ?? 0} file(s)`,
  );
}
