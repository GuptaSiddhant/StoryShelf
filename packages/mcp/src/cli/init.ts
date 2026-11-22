import { readSetting } from "@storyshelf/core/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { printError, printLine } from "./output.ts";
import { readlinePrompter, type Prompter } from "./prompter.ts";
import { detectPackageRunner, installCommand } from "./runner.ts";
import {
  generateTsconfig,
  SCAFFOLD_DEV_DEPENDENCIES,
  writeScaffoldFile,
} from "./scaffold-files.ts";
import {
  MCP_ENTRY,
  generateMcpClientConfig,
  generateMcpDockerfile,
  generateMcpEntry,
  generateMcpEnvExample,
  generateMcpPackageJson,
  type McpScaffoldAnswers,
} from "./scaffold.ts";

export interface McpInitOptions {
  dir?: string;
}

const TRANSPORTS = [
  { title: "stdio (local agents: Claude Code, Cursor)", value: "stdio" },
  { title: "HTTP (remote or shared agents)", value: "http" },
] as const;

/** Ask the questions; `null` when the person cancelled. */
async function collectAnswers(
  ask: Prompter,
  options: McpInitOptions,
  env: NodeJS.ProcessEnv,
): Promise<McpScaffoldAnswers | null> {
  const name = await ask.text("Project name?", "my-storyshelf");
  const dir = name === null ? null : await ask.text("Directory?", `./${name}`);
  const transport = await ask.select("How will agents connect?", TRANSPORTS);
  const url = await ask.text(
    "StoryShelf server URL?",
    readSetting(env, "SHELF_URL") ?? "https://shelf.example.com",
  );
  const slug = await ask.text("Default project slug?", readSetting(env, "SHELF_SLUG") ?? "");
  const docker = await ask.confirm("Add a Dockerfile (HTTP transport)?", false);
  if (
    name === null ||
    dir === null ||
    transport === null ||
    url === null ||
    slug === null ||
    docker === null
  ) {
    return null;
  }
  return { name, dir: options.dir ?? dir, transport, url, slug, docker };
}

/** Ask the questions on `ask`, which is always closed afterwards. */
async function askAll(
  ask: Prompter,
  options: McpInitOptions,
  env: NodeJS.ProcessEnv,
): Promise<McpScaffoldAnswers | null> {
  try {
    return await collectAnswers(ask, options, env);
  } finally {
    ask.close();
  }
}

/** Scaffold a StoryShelf MCP server project (`storyshelf-mcp init`). */
export async function runMcpInit(
  options: McpInitOptions,
  deps: { prompter?: Prompter; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const answers = await askAll(
    deps.prompter ?? readlinePrompter(),
    options,
    deps.env ?? process.env,
  );
  if (!answers?.name || !answers.dir) {
    printError("Cancelled.");
    return;
  }
  const outDir = resolve(answers.dir);
  await mkdir(outDir, { recursive: true });
  await writeFiles(outDir, answers);
  printNextSteps(answers, outDir, installCommand(await detectPackageRunner(process.cwd())));
}

async function writeFiles(outDir: string, answers: McpScaffoldAnswers): Promise<void> {
  await writeScaffoldFile(outDir, MCP_ENTRY, generateMcpEntry(answers.transport));
  await writeFile(
    join(outDir, "package.json"),
    generateMcpPackageJson(answers, SCAFFOLD_DEV_DEPENDENCIES),
  );
  await writeFile(join(outDir, "tsconfig.json"), generateTsconfig());
  await writeFile(join(outDir, ".env.example"), generateMcpEnvExample(answers));
  await writeFile(join(outDir, ".mcp.json"), `${generateMcpClientConfig(answers)}\n`);
  printLine(`Created ${MCP_ENTRY}, package.json, tsconfig.json, .env.example, .mcp.json`);
  if (answers.docker) {
    await writeFile(join(outDir, "Dockerfile"), generateMcpDockerfile());
    printLine(`Created Dockerfile`);
  }
}

function printNextSteps(answers: McpScaffoldAnswers, outDir: string, install: string): void {
  printLine(`\nScaffolded ${answers.name} in ${outDir}`);
  printLine(`\nNext steps:`);
  printLine(`  cd ${answers.dir}`);
  printLine(`  ${install}`);
  printLine(`  cp .env.example .env   # add SHELF_TOKEN (never commit it)`);
  printLine(`  npx storyshelf-mcp serve --dir .`);
  printLine(`\n.mcp.json is a ready client config for Claude Code (copy to your repo root).`);
}
