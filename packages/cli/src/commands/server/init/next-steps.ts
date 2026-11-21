import { resolve } from "node:path";
import { installCommand, startCommand, type PackageRunner } from "../../../config.ts";
import { printLine } from "../../../output.ts";
import { needsCompose, resolveDeployTarget, type Answers } from "./answers.ts";
import { requiredEnv } from "./codegen.ts";

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
    return dockerSteps(needsCompose(answers), answers.auth === "password");
  }
  return [
    ...envSteps(answers),
    `  ${installCommand(runner)}`,
    `  ${startCommand(runner)}`,
    ...(answers.auth === "password" ? [`  # then sign in as admin@example.com`] : []),
  ];
}

/** The commands that set the required variables (or the pointer to `.env.example`), none when nothing is required. */
function envSteps(answers: Answers): string[] {
  const names = requiredEnv(answers);
  if (names.length === 0) {
    return [];
  }
  return [
    `  # Required: ${names.join(", ")}. Set them in the shell, or in .env (copy .env.example):`,
    ...names.map((name) => `  export ${name}=${EXPORT_HINT[name] ?? "..."}`),
  ];
}

const EXPORT_HINT: Record<string, string> = {
  SECRET: `"$(openssl rand -hex 32)"   # keep and reuse it`,
  PUBLIC_BASE_URL: `http://localhost:3000`,
  AUTH_PASSWORD: `...   # the admin's password, 12+ characters`,
};

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

function dockerSteps(compose: boolean, password: boolean): string[] {
  const env = [
    `  export SECRET=...      # at least 32 random characters; keep and reuse it`,
    ...(password
      ? [`  export AUTH_PASSWORD=...  # the local admin's password (12+ characters)`]
      : []),
  ];
  return compose
    ? [
        ...env,
        `  npm run docker:up      # builds + starts the app`,
        `  npm run docker:logs    # follow logs`,
        `  npm run docker:down    # tear down`,
      ]
    : [
        ...env,
        `  npm run docker:build   # builds the image`,
        `  npm run docker:run     # runs it on :3000 (data in a named volume)`,
      ];
}
