/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, max-statements, max-lines-per-function, complexity */
import { createClient } from "../client.ts";
import { assertStorybookMain, writeStorybookConfig } from "../config.ts";
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
  const name = options.name;
  const token = options.token ?? process.env["STORYSHELF_ADMIN_TOKEN"] ?? process.env["ADMIN_TOKEN"];

  if (!url) {
    printError("--url is required (or STORYSHELF_URL env)");
    process.exitCode = 1;
    return;
  }
  if (!name) {
    printError("--name is required");
    process.exitCode = 1;
    return;
  }
  if (!token) {
    printError("--token is required for site-admin (or STORYSHELF_ADMIN_TOKEN env)");
    process.exitCode = 1;
    return;
  }

  const client = createClient(url, token);
  const project = await client.projects.create({ name });
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
