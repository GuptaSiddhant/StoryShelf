import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { printLine } from "../../../output.ts";
import { generateTsconfig, SERVER_ENTRY, writeScaffoldFile } from "../../shared/scaffold.ts";
import { generateComposeYaml, generateDockerfile, generateDockerignore } from "../docker.ts";
import { generateAwsTerraformFiles } from "../terraform-aws.ts";
import { generateAzureTerraformFiles } from "../terraform-azure.ts";
import { generateGcpTerraformFiles } from "../terraform-gcp.ts";
import { needsCompose, resolveDeployTarget, type Answers } from "./answers.ts";
import { generateServer } from "./codegen.ts";
import { generatePackageJson } from "./package-json.ts";

export async function writeFiles(outDir: string, answers: Answers): Promise<void> {
  await writeEntryFiles(outDir, answers);
  await writeTerraformFiles(outDir, answers);
  await writeDockerFiles(outDir, answers);
}

async function writeEntryFiles(outDir: string, answers: Answers): Promise<void> {
  await writeScaffoldFile(outDir, SERVER_ENTRY, generateServer(answers));
  printLine(`Created ${SERVER_ENTRY}`);
  await writeFile(join(outDir, "package.json"), generatePackageJson(answers));
  await writeFile(join(outDir, "tsconfig.json"), generateTsconfig());
  printLine(`Created package.json, tsconfig.json`);
}

/** The Terraform reference stack (`terraform/*.tf` + README) of each cloud target, as relative path to contents. */
const TERRAFORM_FILES: Record<string, (answers: Answers) => Record<string, string>> = {
  aws: (answers) =>
    generateAwsTerraformFiles({
      project: answers.name,
      region: answers.awsRegion ?? "us-east-1",
      ...(answers.domainName ? { domainName: answers.domainName } : {}),
      ...(answers.samlMetadataUrl ? { samlMetadataUrl: answers.samlMetadataUrl } : {}),
    }),
  azure: (answers) =>
    generateAzureTerraformFiles({
      project: answers.name,
      location: answers.azureLocation ?? "eastus",
      ...(answers.domainName ? { domainName: answers.domainName } : {}),
      ...(answers.entraTenantId ? { entraTenantId: answers.entraTenantId } : {}),
    }),
  gcp: (answers) =>
    generateGcpTerraformFiles({
      project: answers.name,
      gcpProjectId: answers.gcpProjectId ?? "",
      location: answers.gcpLocation ?? "us-central1",
      ...(answers.domainName ? { domainName: answers.domainName } : {}),
      ...(answers.identityTenant ? { identityTenant: answers.identityTenant } : {}),
    }),
};

/** Write the Terraform reference stack of an AWS, Azure or GCP target; other targets have none. */
async function writeTerraformFiles(outDir: string, answers: Answers): Promise<void> {
  const files = TERRAFORM_FILES[resolveDeployTarget(answers)]?.(answers);
  if (!files) {
    return;
  }
  await mkdir(join(outDir, "terraform"), { recursive: true });
  await Promise.all(
    Object.entries(files).map(async ([relative, contents]) => {
      await writeFile(join(outDir, relative), contents);
    }),
  );
  printLine(`Created terraform/ (${Object.keys(files).length} files)`);
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
