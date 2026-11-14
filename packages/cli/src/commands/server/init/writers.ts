import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { printLine } from "../../../output.ts";
import { generateTsconfig, SERVER_ENTRY, writeScaffoldFile } from "../../shared/scaffold.ts";
import { generateComposeYaml, generateDockerfile, generateDockerignore } from "../docker.ts";
import { needsCompose, type Answers } from "./answers.ts";
import { generateServer } from "./codegen.ts";
import { generatePackageJson } from "./package-json.ts";

export async function writeFiles(outDir: string, answers: Answers): Promise<void> {
  await writeEntryFiles(outDir, answers);
  await writeDockerFiles(outDir, answers);
}

async function writeEntryFiles(outDir: string, answers: Answers): Promise<void> {
  await writeScaffoldFile(outDir, SERVER_ENTRY, generateServer(answers));
  printLine(`Created ${SERVER_ENTRY}`);
  await writeFile(join(outDir, "package.json"), generatePackageJson(answers));
  await writeFile(join(outDir, "tsconfig.json"), generateTsconfig());
  printLine(`Created package.json, tsconfig.json`);
}

async function writeDockerFiles(outDir: string, answers: Answers): Promise<void> {
  if (!answers.docker) {
    return;
  }
  const created = ["Dockerfile", ".dockerignore"];
  await writeFile(join(outDir, "Dockerfile"), generateDockerfile());
  await writeFile(join(outDir, ".dockerignore"), generateDockerignore());
  if (needsCompose(answers)) {
    await writeFile(join(outDir, "compose.yaml"), generateComposeYaml(answers.database));
    created.push("compose.yaml");
  }
  printLine(`Created ${created.join(", ")}`);
}
