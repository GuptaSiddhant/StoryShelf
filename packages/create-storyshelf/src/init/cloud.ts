import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import prompts from "prompts";
import { printError, printLine } from "../output.ts";
import { packageVersion } from "../version.ts";
import { STATE_WARNING, writeStateGitignore } from "./state-files.ts";

/** The clouds that have a Terraform module under `deploy/terraform/` (ADR 0050). */
export const CLOUDS = ["aws", "gcp", "azure"] as const;
export type Cloud = (typeof CLOUDS)[number];

/** Whether a `--cloud` value names a cloud with a module. */
export function isCloud(value: string): value is Cloud {
  return (CLOUDS as readonly string[]).includes(value);
}

/** What the prompts collect: the module inputs that every cloud takes, plus the cloud's own. */
export interface CloudAnswers {
  dir: string;
  name: string;
  /** The AWS region, GCP region or Azure location. */
  location: string;
  /** The GCP project ID; GCP only. */
  projectId?: string;
  /** The public domain; empty leaves the stack on the cloud's default hostname. AWS only. */
  domainName?: string;
  /** The public origin (`public_base_url`); empty uses the Cloud Run origin. GCP only. */
  publicBaseUrl?: string;
  /** The IPv4 CIDR ranges allowed to reach the app, comma-separated; AWS and Azure. */
  allowedCidrBlocks?: string;
}

const REPOSITORY = "git::https://github.com/GuptaSiddhant/StoryShelf.git";

const LOCATION: Record<Cloud, { variable: string; message: string; initial: string }> = {
  aws: { variable: "region", message: "AWS region?", initial: "us-east-1" },
  gcp: { variable: "region", message: "GCP region?", initial: "us-central1" },
  azure: { variable: "location", message: "Azure location?", initial: "eastus" },
};

/** The module inputs beyond `name` and the location, as each module declares them. */
const EXTRA_INPUTS: Record<Cloud, string[]> = {
  aws: ["allowed_cidr_blocks", "domain_name"],
  gcp: ["project_id", "public_base_url"],
  azure: ["allowed_cidr_blocks"],
};

/** Inputs that may stay empty: the module has a default for them. */
const OPTIONAL_INPUTS = new Set(["domain_name", "public_base_url"]);

/** The `main.tf` that pins the module at the CLI's own release tag. */
export function generateMainTf(cloud: Cloud, version: string): string {
  const { variable } = LOCATION[cloud];
  const inputs = ["name", variable, ...EXTRA_INPUTS[cloud]];
  const lines = [
    `module "storyshelf" {`,
    `  source        = "${REPOSITORY}//deploy/terraform/${cloud}?ref=v${version}"`,
    `  image_version = "${version}"`,
    ...inputs.map((input) => `  ${input.padEnd(13)} = var.${input}`),
    `}`,
    ``,
  ];
  for (const input of inputs) {
    const optional = OPTIONAL_INPUTS.has(input) ? ['  default     = ""'] : [];
    const type = input === "allowed_cidr_blocks" ? "list(string)" : "string";
    lines.push(`variable "${input}" {`, `  type = ${type}`, ...optional, `}`, ``);
  }
  lines.push(`output "url" {`, `  value = module.storyshelf.url`, `}`, ``);
  return lines.join("\n");
}

/** The `terraform.tfvars` with the answers to the prompts. */
export function generateTfvars(cloud: Cloud, answers: CloudAnswers): string {
  const lines: [string, string | undefined][] = [
    ["name", answers.name],
    [LOCATION[cloud].variable, answers.location],
    ["project_id", cloud === "gcp" ? answers.projectId : undefined],
    ["domain_name", cloud === "aws" ? (answers.domainName ?? "") : undefined],
    ["public_base_url", cloud === "gcp" ? (answers.publicBaseUrl ?? "") : undefined],
  ];
  const cidrs = cloud === "gcp" ? undefined : splitList(answers.allowedCidrBlocks);
  return `${lines
    .filter((line): line is [string, string] => line[1] !== undefined)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .concat(cidrs ? [`allowed_cidr_blocks = ${JSON.stringify(cidrs)}`] : [])
    .join("\n")}\n`;
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function collect(cloud: Cloud, dir: string | undefined): Promise<CloudAnswers | null> {
  const where = LOCATION[cloud];
  const answers = (await prompts([
    { type: "text", name: "name", message: "Deployment name?", initial: "storyshelf" },
    { type: "text", name: "location", message: where.message, initial: where.initial },
    ...(cloud === "gcp"
      ? [{ type: "text" as const, name: "projectId", message: "GCP project ID?" }]
      : []),
    ...(cloud === "gcp"
      ? [
          {
            type: "text" as const,
            name: "publicBaseUrl",
            message:
              "Public origin, e.g. https://shelf.example.com? (empty uses the Cloud Run URL)",
            initial: "",
          },
        ]
      : [
          {
            type: "text" as const,
            name: "allowedCidrBlocks",
            message: "CIDR ranges allowed to reach the app? (comma-separated)",
          },
        ]),
    ...(cloud === "aws"
      ? [
          {
            type: "text" as const,
            name: "domainName",
            message: "Public domain? (empty skips DNS)",
            initial: "",
          },
        ]
      : []),
  ])) as Partial<CloudAnswers>;
  if (
    !answers.name ||
    !answers.location ||
    (cloud === "gcp" && !answers.projectId) ||
    (cloud !== "gcp" && splitList(answers.allowedCidrBlocks).length === 0)
  ) {
    printError("Cancelled.");
    return null;
  }
  return { ...answers, dir: dir ?? `./${answers.name}-infra` } as CloudAnswers;
}

/**
 * `create-storyshelf --cloud <cloud>`: write a `main.tf` that uses the cloud's Terraform module
 * at this CLI's version, and a `terraform.tfvars` from the prompts. The module deploys the
 * published image, so there is no application code to scaffold.
 */
export async function runCloudInit(cloud: Cloud, dir: string | undefined): Promise<void> {
  const answers = await collect(cloud, dir);
  if (answers !== null) {
    await writeStub(cloud, answers);
  }
}

async function writeStub(cloud: Cloud, answers: CloudAnswers): Promise<void> {
  const outDir = resolve(answers.dir);
  if (existsSync(join(outDir, "main.tf"))) {
    printError(`${join(answers.dir, "main.tf")} already exists; not overwriting it.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "main.tf"), generateMainTf(cloud, packageVersion() ?? "0.0.0-dev"));
  await writeFile(join(outDir, "terraform.tfvars"), generateTfvars(cloud, answers));
  await writeStateGitignore(join(outDir, ".gitignore"));
  printNextSteps(outDir, answers.dir);
}

function printNextSteps(outDir: string, dir: string): void {
  printLine(`Created main.tf, terraform.tfvars, .gitignore in ${outDir}`);
  printLine(STATE_WARNING);
  printLine(`\nNext steps:\n  cd ${dir}\n  terraform init\n  terraform plan -out=tfplan`);
  printLine(`  terraform apply tfplan`);
}
