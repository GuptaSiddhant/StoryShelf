import { createClient } from "../client.ts";
import {
  assertStorybookMain,
  detectGitDefaultBranch,
  detectGitRepository,
  detectPackageName,
  detectStorybookMeta,
  type StorybookMeta,
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
  /** Working directory (defaults to process.cwd()). Test seam for fs access. */
  cwd?: string;
}

interface ProjectResponse {
  slug: string;
}

interface TokenResponse {
  token: string;
}

interface CreateInputs {
  url?: string;
  name?: string;
  token?: string;
  gitRepository?: string;
  gitDefaultBranch?: string;
  storybookMeta: StorybookMeta;
}

async function readCreateInputs(options: CreateOptions, cwd: string): Promise<CreateInputs> {
  const rawName = options.name === "" ? undefined : options.name;
  const name = rawName ?? (await detectPackageName(cwd));
  return {
    url: options.url ?? process.env["STORYSHELF_URL"] ?? process.env["STORYSHELF_HOST"],
    name: name ?? undefined,
    token: options.token ?? process.env["STORYSHELF_ADMIN_TOKEN"] ?? process.env["ADMIN_TOKEN"],
    gitRepository: detectGitRepository(cwd) ?? undefined,
    gitDefaultBranch: detectGitDefaultBranch(cwd) ?? undefined,
    storybookMeta: await detectStorybookMeta(cwd),
  };
}

function createInputError(inputs: CreateInputs): string | null {
  if (!inputs.url) {
    return "--url is required (or STORYSHELF_URL env)";
  }
  if (!inputs.name) {
    return "--name is required (or ensure package.json has a name)";
  }
  if (!inputs.token) {
    return "--token is required for site-admin (or STORYSHELF_ADMIN_TOKEN env)";
  }
  return null;
}

interface CreatePayload {
  name: string;
  gitRepository?: string;
  gitDefaultBranch?: string;
  storybookMeta?: unknown;
}

function buildCreatePayload(name: string, inputs: CreateInputs): CreatePayload {
  const payload: CreatePayload = { name };
  if (inputs.gitRepository) {
    payload.gitRepository = inputs.gitRepository;
  }
  if (inputs.gitDefaultBranch) {
    payload.gitDefaultBranch = inputs.gitDefaultBranch;
  }
  if (Object.keys(inputs.storybookMeta).length > 0) {
    payload.storybookMeta = inputs.storybookMeta;
  }
  return payload;
}

async function executeCreate(
  url: string,
  token: string,
  payload: CreatePayload,
  cwd: string,
): Promise<void> {
  const client = createClient(url, token);
  const project = (await client.projects.create(payload)) as ProjectResponse;
  const tokenRes = (await client.projects.tokens.create(project.slug, { name: "ci" })) as TokenResponse;
  // Write client config without token
  const written = await writeStorybookConfig({ slug: project.slug, url }, cwd);
  printLine(`Project slug: ${project.slug}`);
  printLine(`CI token: ${tokenRes.token}`);
  printLine(`Wrote ${written}`);
  printLine("Store CI token in secrets (STORYSHELF_TOKEN) — not in git");
}

/**
 * Create a project and CI token on a StoryShelf server.
 * Requires .storybook/main.* to exist and writes .storybook/storyshelf.json.
 *
 * @param options - Create command options.
 */
export async function runCreate(options: CreateOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  await assertStorybookMain(cwd);
  const inputs = await readCreateInputs(options, cwd);
  const error = createInputError(inputs);
  if (error || !inputs.url || !inputs.name || !inputs.token) {
    printError(error ?? "Missing required options");
    process.exitCode = 1;
    return;
  }
  await executeCreate(inputs.url, inputs.token, buildCreatePayload(inputs.name, inputs), cwd);
}
