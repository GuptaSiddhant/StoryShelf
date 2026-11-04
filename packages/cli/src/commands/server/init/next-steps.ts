import { resolve } from "node:path";
import { installCommand, startCommand, type PackageRunner } from "../../../config.ts";
import { printLine } from "../../../output.ts";
import { needsCompose, resolveDeployTarget, type Answers } from "./answers.ts";

export function printNextSteps(answers: Answers, runner: PackageRunner): void {
  printLine(`\nScaffolded ${answers.name} in ${resolve(answers.dir)}`);
  printLine(`\nNext steps:`);
  printLine(`  cd ${answers.dir}`);

  const target = resolveDeployTarget(answers);
  if (target === "aws") {
    printLine(`  terraform -chdir=terraform init`);
    printLine(`  terraform -chdir=terraform plan -out=tfplan   # review before applying`);
    printLine(`  terraform -chdir=terraform apply tfplan       # or: npm run infra:apply`);
    printLine(`  # wire outputs into env (terraform output -json / npm run infra:outputs):`);
    printLine(`  #   S3_BUCKET / AWS_REGION, DATABASE_URL, COGNITO_* credentials`);
    printLine(`  npm install`);
    printLine(`  npm start`);
    return;
  }

  if (target === "azure") {
    printLine(`  az login`);
    printLine(`  terraform -chdir=terraform init`);
    printLine(`  terraform -chdir=terraform plan -out=tfplan   # review before applying`);
    printLine(`  terraform -chdir=terraform apply tfplan       # or: npm run infra:apply`);
    printLine(`  # wire outputs into env (terraform output -json / npm run infra:outputs):`);
    printLine(`  #   AZURE_STORAGE_CONNECTION, DATABASE_URL, OIDC_* credentials`);
    printLine(`  npm install`);
    printLine(`  npm start`);
    return;
  }

  if (target === "gcp") {
    printLine(`  gcloud auth login`);
    printLine(`  terraform -chdir=terraform init`);
    printLine(`  terraform -chdir=terraform plan -out=tfplan   # review before applying`);
    printLine(`  terraform -chdir=terraform apply tfplan       # or: npm run infra:apply`);
    printLine(`  # wire outputs into env (terraform output -json / npm run infra:outputs):`);
    printLine(`  #   GCS_BUCKET + GOOGLE_CLOUD_PROJECT, DATABASE_URL, OIDC_* credentials`);
    printLine(`  npm install`);
    printLine(`  npm start`);
    return;
  }

  if (target === "docker") {
    if (needsCompose(answers)) {
      printLine(`  npm run docker:up      # builds + starts the app`);
      printLine(`  npm run docker:logs    # follow logs`);
      printLine(`  npm run docker:down    # tear down`);
    } else {
      printLine(`  npm run docker:build   # builds the image`);
      printLine(`  npm run docker:run     # runs it on :3000 (data in a named volume)`);
    }
    return;
  }

  printLine(`  ${installCommand(runner)}`);
  printLine(`  ${startCommand(runner)}`);
}
