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
  /** Admin token (fallback to STORYSHELF_ADMIN_TOKEN / ADMIN_TOKEN env); not needed when the server has sign-in off. */
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
  return null;
}

/** Why the server needs an admin token, shown when none was given and sign-in is on or unknown. */
const TOKEN_REQUIRED =
  "--token is required for site-admin (or STORYSHELF_ADMIN_TOKEN env) because the server has sign-in enabled";

/** Whether the server reports sign-in on; an unreachable or older server counts as off (the old behaviour). */
async function serverHasAuth(url: string): Promise<boolean> {
  try {
    return (await createClient(url).health()).auth === true;
  } catch {
    return false;
  }
}

/**
 * Whether the server reports sign-in off (development mode, ADR 0008), so `create` needs no token.
 * An unreachable server or an older one without the field counts as "needs a token".
 */
async function serverHasNoAuth(url: string): Promise<boolean> {
  try {
    return (await createClient(url).health()).auth === false;
  } catch {
    return false;
  }
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
  token: string | undefined,
  payload: CreatePayload,
  cwd: string,
): Promise<void> {
  const client = createClient(url, token);
  const project = (await client.projects.create(payload)) as ProjectResponse;
  // Write client config without token, before the token call, so a failure there leaves it usable.
  const written = await writeStorybookConfig({ slug: project.slug, url }, cwd);
  printLine(`Project slug: ${project.slug}`);
  printLine(`Wrote ${written}`);
  if (await serverHasAuth(url)) {
    printTokenPointer(url, project.slug);
    return;
  }
  await mintCiToken(client, project.slug, written);
}

/**
 * With sign-in on, a token minted here has no owner and so cannot upload (ADR 0013): print where
 * to make one instead (the project's page shows the "Get your first build" card).
 */
function printTokenPointer(url: string, slug: string): void {
  printLine(
    `The server has sign-in on, so no CI token is created here (one made with the admin token could not upload).`,
  );
  printLine(
    `Next: open ${url.replace(/\/+$/u, "")}/projects/${slug}/builds, sign in, create a token under "Get your first build", and store it as STORYSHELF_TOKEN.`,
  );
}

/** Mint the CI token; a failure after the project exists says so and prints the next step. */
async function mintCiToken(
  client: ReturnType<typeof createClient>,
  slug: string,
  written: string,
): Promise<void> {
  try {
    const tokenRes = (await client.projects.tokens.create(slug, { name: "ci" })) as TokenResponse;
    printLine(`CI token: ${tokenRes.token}`);
    printLine("Store CI token in secrets (STORYSHELF_TOKEN) — not in git");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    printError(
      `Project "${slug}" was created and ${written} written, but the CI token could not be created: ${reason}`,
    );
    printError(
      `Next: create a token for "${slug}" in the project's settings (or rerun with a valid --token), then store it as STORYSHELF_TOKEN. Do not run create again: the project exists.`,
    );
    process.exitCode = 1;
  }
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
  const error = await createBlocker(inputs);
  if (error || !inputs.url || !inputs.name) {
    printError(error ?? "Missing required options");
    process.exitCode = 1;
    return;
  }
  await executeCreate(inputs.url, inputs.token, buildCreatePayload(inputs.name, inputs), cwd);
}

/** The reason `create` cannot go ahead, or null: bad inputs, or no token for a server with sign-in. */
async function createBlocker(inputs: CreateInputs): Promise<string | null> {
  const error = createInputError(inputs);
  if (error || inputs.token || !inputs.url) {
    return error;
  }
  return (await serverHasNoAuth(inputs.url)) ? null : TOKEN_REQUIRED;
}
