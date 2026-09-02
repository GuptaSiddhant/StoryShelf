/* oxlint-disable max-statements, max-lines-per-function, complexity, eslint/max-statements, eslint/max-lines-per-function, eslint/complexity, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/prefer-nullish-coalescing, typescript/prefer-regexp-exec, eslint/no-await-in-loop, no-await-in-loop, max-depth, eslint/max-depth, eslint/no-useless-escape, no-useless-escape */
import { createClient } from "../client.ts";
import {
  assertStorybookMain,
  detectGitDefaultBranch,
  detectGitRepository,
  detectPackageName,
  detectStorybookMeta,
  writeStorybookConfig,
} from "../config.ts";
import { printError, printLine } from "../output.ts";

/** Options for the `create` command (project creation). */
export interface CreateOptions {
  /** Server base URL. */
  url?: string;
  /** Project name. */
  name?: string;
  /** Admin token (fallback to STORYSHELF_ADMIN_TOKEN / ADMIN_TOKEN env). */
  token?: string;
}

interface ProjectResponse {
  slug: string;
}

interface TokenResponse {
  token: string;
}

/**
 * Create a project and CI token on a StoryShelf server.
 * Requires .storybook/main.* to exist and writes .storybook/storyshelf.json.
 *
 * @param options - Create command options.
 */
export async function runCreate(options: CreateOptions): Promise<void> {
  await assertStorybookMain();

  const url = options.url ?? process.env["STORYSHELF_URL"] ?? process.env["STORYSHELF_HOST"];
  let name = options.name;
  const token = options.token ?? process.env["STORYSHELF_ADMIN_TOKEN"] ?? process.env["ADMIN_TOKEN"];

  if (!url) {
    printError("--url is required (or STORYSHELF_URL env)");
    process.exitCode = 1;
    return;
  }
  if (!name) {
    name = await detectPackageName() ?? undefined;
  }
  if (!name) {
    printError("--name is required (or ensure package.json has a name)");
    process.exitCode = 1;
    return;
  }
  if (!token) {
    printError("--token is required for site-admin (or STORYSHELF_ADMIN_TOKEN env)");
    process.exitCode = 1;
    return;
  }

  const gitRepository = detectGitRepository() ?? undefined;
  const gitDefaultBranch = detectGitDefaultBranch() ?? undefined;
  const storybookMeta = await detectStorybookMeta();

  const payload: { name: string; gitRepository?: string; gitDefaultBranch?: string; storybookMeta?: unknown } = {
    name,
  };
  if (gitRepository) payload.gitRepository = gitRepository;
  if (gitDefaultBranch) payload.gitDefaultBranch = gitDefaultBranch;
  if (Object.keys(storybookMeta).length > 0) {
    payload.storybookMeta = storybookMeta;
  }

  const client = createClient(url, token);
  const project = await client.projects.create(payload);
  const projectData = project as ProjectResponse;
  const tokenRes = await client.projects.tokens.create(projectData.slug, { name: "ci" });
  const tokenData = tokenRes as TokenResponse;

  // Write client config without token
  const written = await writeStorybookConfig({ slug: projectData.slug, url });
  printLine(`Project slug: ${projectData.slug}`);
  printLine(`CI token: ${tokenData.token}`);
  printLine(`Wrote ${written}`);
  printLine("Store CI token in secrets (STORYSHELF_TOKEN) — not in git");
}
