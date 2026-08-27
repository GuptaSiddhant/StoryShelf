import { normalizeBaseUrl, postJson } from "../client.ts";
import { printLine } from "../output.ts";

interface ProjectResponse {
  slug: string;
}

interface TokenResponse {
  token: string;
}

export interface InitOptions {
  url: string;
  name: string;
}

export async function runInit(options: InitOptions): Promise<void> {
  const base = normalizeBaseUrl(options.url);
  const project = await postJson<ProjectResponse>(`${base}/api/v1/projects`, { name: options.name });
  const token = await postJson<TokenResponse>(`${base}/api/v1/projects/${project.slug}/tokens`, { name: "ci" });
  printLine(`Project slug: ${project.slug}`);
  printLine(`CI token: ${token.token}`);
}
