import { normalizeBaseUrl, postJson } from "../client.ts";
import { printLine } from "../output.ts";

interface BuildResponse {
  id: string;
}

export interface UploadOptions {
  url: string;
  slug: string;
  token: string;
  sha: string;
  branch: string;
}

export async function runUpload(options: UploadOptions): Promise<void> {
  const base = normalizeBaseUrl(options.url);
  const build = await postJson<BuildResponse>(
    `${base}/api/v1/projects/${options.slug}/builds`,
    { gitSha: options.sha, gitBranch: options.branch },
    { authorization: `Bearer ${options.token}` },
  );
  printLine(`Build created: ${build.id}`);
}
