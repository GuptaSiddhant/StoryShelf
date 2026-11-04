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
  await writeScaffoldFile(outDir, SERVER_ENTRY, generateServer(answers));
  printLine(`Created ${SERVER_ENTRY}`);

  await writeFile(join(outDir, "package.json"), generatePackageJson(answers));
  await writeFile(join(outDir, "tsconfig.json"), generateTsconfig());
  printLine(`Created package.json, tsconfig.json`);

  if (resolveDeployTarget(answers) === "aws") {
    await writeTerraformFiles(outDir, answers);
  }

  if (resolveDeployTarget(answers) === "azure") {
    await writeAzureTerraformFiles(outDir, answers);
  }

  if (resolveDeployTarget(answers) === "gcp") {
    await writeGcpTerraformFiles(outDir, answers);
  }

  await writeDockerFiles(outDir, answers);
}

/** Write the GCP Terraform reference stack (`terraform/*.tf` + README). */
async function writeGcpTerraformFiles(outDir: string, answers: Answers): Promise<void> {
  const files = generateGcpTerraformFiles({
    project: answers.name,
    gcpProjectId: answers.gcpProjectId ?? "",
    location: answers.gcpLocation ?? "us-central1",
    ...(answers.domainName ? { domainName: answers.domainName } : {}),
    ...(answers.identityTenant ? { identityTenant: answers.identityTenant } : {}),
  });
  await mkdir(join(outDir, "terraform"), { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    await writeFile(join(outDir, relative), contents);
  }
  printLine(`Created terraform/ (${Object.keys(files).length} files)`);
}

/** Write the Azure Terraform reference stack (`terraform/*.tf` + README). */
async function writeAzureTerraformFiles(outDir: string, answers: Answers): Promise<void> {
  const files = generateAzureTerraformFiles({
    project: answers.name,
    location: answers.azureLocation ?? "eastus",
    ...(answers.domainName ? { domainName: answers.domainName } : {}),
    ...(answers.entraTenantId ? { entraTenantId: answers.entraTenantId } : {}),
  });
  await mkdir(join(outDir, "terraform"), { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    await writeFile(join(outDir, relative), contents);
  }
  printLine(`Created terraform/ (${Object.keys(files).length} files)`);
}

/** Write the AWS Terraform reference stack (`terraform/*.tf` + README). */
async function writeTerraformFiles(outDir: string, answers: Answers): Promise<void> {
  const files = generateAwsTerraformFiles({
    project: answers.name,
    region: answers.awsRegion ?? "us-east-1",
    ...(answers.domainName ? { domainName: answers.domainName } : {}),
    ...(answers.samlMetadataUrl ? { samlMetadataUrl: answers.samlMetadataUrl } : {}),
  });
  await mkdir(join(outDir, "terraform"), { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    await writeFile(join(outDir, relative), contents);
  }
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
