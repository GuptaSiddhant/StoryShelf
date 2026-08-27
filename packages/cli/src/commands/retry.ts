import { normalizeBaseUrl, postJson } from "../client.ts";
import { printLine } from "../output.ts";

interface BuildResponse {
  id: string;
}

export interface RetryOptions {
  url: string;
  slug: string;
  buildId: string;
}

export async function runRetry(options: RetryOptions): Promise<void> {
  const base = normalizeBaseUrl(options.url);
  const build = await postJson<BuildResponse>(
    `${base}/api/v1/projects/${options.slug}/builds/${options.buildId}/retry`,
    {},
  );
  printLine(`Build ${build.id} queued for retry`);
}
