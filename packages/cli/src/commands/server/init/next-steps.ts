import { resolve } from "node:path";
import { installCommand, startCommand, type PackageRunner } from "../../../config.ts";
import { printLine } from "../../../output.ts";
import { needsCompose, resolveDeployTarget, type Answers } from "./answers.ts";

export function printNextSteps(answers: Answers, runner: PackageRunner): void {
  printLine(`\nScaffolded ${answers.name} in ${resolve(answers.dir)}`);
  printLine(`\nNext steps:`);
  printLine(`  cd ${answers.dir}`);
  for (const line of stepsFor(answers, runner)) {
    printLine(line);
  }
}

/** The target-specific commands, one per line. */
function stepsFor(answers: Answers, runner: PackageRunner): string[] {
  const target = resolveDeployTarget(answers);
  const cloud = CLOUD_STEPS[target];
  if (cloud) {
    return terraformSteps(cloud);
  }
  if (target === "docker") {
    return dockerSteps(needsCompose(answers));
  }
  return [`  ${installCommand(runner)}`, `  ${startCommand(runner)}`];
}

interface CloudSteps {
  /** The sign-in command run before Terraform, if the cloud's CLI needs one. */
  login?: string;
  /** The environment variables the Terraform outputs feed. */
  env: string;
}

const CLOUD_STEPS: Record<string, CloudSteps | undefined> = {
  aws: { env: "S3_BUCKET / AWS_REGION, DATABASE_URL, COGNITO_* credentials" },
  azure: { login: "az login", env: "AZURE_STORAGE_CONNECTION, DATABASE_URL, OIDC_* credentials" },
  gcp: {
    login: "gcloud auth login",
    env: "GCS_BUCKET + GOOGLE_CLOUD_PROJECT, DATABASE_URL, OIDC_* credentials",
  },
};

function terraformSteps(cloud: CloudSteps): string[] {
  return [
    ...(cloud.login ? [`  ${cloud.login}`] : []),
    `  terraform -chdir=terraform init`,
    `  terraform -chdir=terraform plan -out=tfplan   # review before applying`,
    `  terraform -chdir=terraform apply tfplan       # or: npm run infra:apply`,
    `  # wire outputs into env (terraform output -json / npm run infra:outputs):`,
    `  #   ${cloud.env}`,
    `  npm install`,
    `  npm start`,
  ];
}

function dockerSteps(compose: boolean): string[] {
  return compose
    ? [
        `  npm run docker:up      # builds + starts the app`,
        `  npm run docker:logs    # follow logs`,
        `  npm run docker:down    # tear down`,
      ]
    : [
        `  npm run docker:build   # builds the image`,
        `  npm run docker:run     # runs it on :3000 (data in a named volume)`,
      ];
}
