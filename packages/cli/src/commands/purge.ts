import { normalizeBaseUrl, postJson } from "../client.ts";
import { printLine } from "../output.ts";

interface PurgeResponse {
  removedBuilds: number;
}

export interface PurgeOptions {
  url: string;
}

export async function runPurge(options: PurgeOptions): Promise<void> {
  const base = normalizeBaseUrl(options.url);
  const result = await postJson<PurgeResponse>(`${base}/api/v1/admin/purge`, {});
  printLine(`Removed ${result.removedBuilds} build(s)`);
}
