import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { detectPackageRunner, installCommand } from "../../config.ts";
import { printError } from "../../output.ts";
import { defaultSpawnProcess, type SpawnProcess } from "../worker/serve.ts";

export interface McpServeOptions {
  dir?: string;
  url?: string;
  slug?: string;
  token?: string;
  port?: string;
}

const MCP_CANDIDATES = [
  "src/index.ts",
  "src/index.js",
  "src/index.mjs",
  "index.ts",
  "index.js",
  "index.mjs",
] as const;

/** Find the entry of a scaffolded MCP project. */
export async function resolveMcpFile(dir: string): Promise<string> {
  for (const candidate of MCP_CANDIDATES) {
    const full = join(dir, candidate);
    try {
      // oxlint-disable-next-line no-await-in-loop -- probe in order
      await access(full);
      return full;
    } catch {
      continue;
    }
  }
  throw new Error(
    `No MCP entry found in ${dir} (looked for ${MCP_CANDIDATES.join(", ")}). Run "storyshelf mcp init" first.`,
  );
}

/** Run a scaffolded MCP project (`storyshelf mcp serve`). Flags map to STORYSHELF_* env. */
export async function runMcpServe(
  options: McpServeOptions,
  deps: { spawnProcess?: SpawnProcess } = {},
): Promise<void> {
  const dir = resolve(options.dir ?? process.cwd());
  const file = await resolveMcpFile(dir);
  // stdout is the protocol channel for stdio servers: all status goes to stderr.
  await warnIfUninstalled(dir);
  printError(`Starting MCP server: ${file}`);
  const spawnProcess = deps.spawnProcess ?? defaultSpawnProcess;
  const code = await spawnProcess(process.execPath, [file], { cwd: dir, env: childEnv(options) });
  if (code !== 0) {
    throw new Error(`MCP server exited with code ${code}`);
  }
}

function childEnv(options: McpServeOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.url !== undefined) env["STORYSHELF_URL"] = options.url;
  if (options.slug !== undefined) env["STORYSHELF_SLUG"] = options.slug;
  if (options.token !== undefined) env["STORYSHELF_TOKEN"] = options.token;
  if (options.port !== undefined) env["PORT"] = options.port;
  return env;
}

async function warnIfUninstalled(dir: string): Promise<void> {
  try {
    await access(join(dir, "node_modules"));
  } catch {
    const runner = await detectPackageRunner(dir);
    printError(`Warning: no node_modules in ${dir} — run "${installCommand(runner)}" there first.`);
  }
}
