import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import prompts from "prompts";
import { detectPackageRunner, installCommand } from "../../config.ts";
import { printError, printLine } from "../../output.ts";
import { PROJECT_PROMPTS } from "../server/prompts.ts";
import {
  SCAFFOLD_DEV_DEPENDENCIES,
  generateTsconfig,
  writeScaffoldFile,
} from "../shared/scaffold.ts";
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

const MCP_PROMPTS = [
  {
    type: "select",
    name: "transport",
    message: "How will agents connect?",
    choices: [
      { title: "stdio (local agents: Claude Code, Cursor)", value: "stdio" },
      { title: "HTTP (remote or shared agents)", value: "http" },
    ],
  },
  {
    type: "text",
    name: "url",
    message: "StoryShelf server URL?",
    initial: process.env["STORYSHELF_URL"] ?? "https://shelf.example.com",
  },
  {
    type: "text",
    name: "slug",
    message: "Default project slug?",
    initial: process.env["STORYSHELF_SLUG"] ?? "",
  },
  {
    type: "confirm",
    name: "docker",
    message: "Add a Dockerfile (HTTP transport)?",
    initial: false,
  },
] as const;

/** Scaffold a StoryShelf MCP server project (`storyshelf mcp init`). */
export async function runMcpInit(options: McpInitOptions): Promise<void> {
  const responses = (await prompts([
    ...PROJECT_PROMPTS,
    ...MCP_PROMPTS,
  ] as never)) as Partial<McpScaffoldAnswers>;
  if (!responses.name || !responses.dir) {
    printError("Cancelled.");
    return;
  }
  const answers = { ...responses, dir: options.dir ?? responses.dir } as McpScaffoldAnswers;
  const outDir = resolve(answers.dir);
  await mkdir(outDir, { recursive: true });
  await writeFiles(outDir, answers);
  const runner = await detectPackageRunner(process.cwd());
  printNextSteps(answers, outDir, installCommand(runner));
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
  printLine(`  cp .env.example .env   # add STORYSHELF_TOKEN (never commit it)`);
  printLine(`  npx storyshelf mcp serve --dir .`);
  printLine(`\n.mcp.json is a ready client config for Claude Code (copy to your repo root).`);
}
