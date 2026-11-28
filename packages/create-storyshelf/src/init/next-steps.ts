import { resolve } from "node:path";
import { printLine } from "../output.ts";
import {
  browserInstallCommand,
  installCommand,
  startCommand,
  type PackageRunner,
} from "../runner.ts";
import { needsCompose, resolveDeployTarget, type Answers } from "./answers.ts";
import { requiredEnv } from "./codegen.ts";
import { databaseUrlExample } from "./env-files.ts";

/** `installed`: the dependencies were just installed (`--install`), so the install step is left out. */
export function printNextSteps(answers: Answers, runner: PackageRunner, installed = false): void {
  printLine(`\nScaffolded ${answers.name} in ${resolve(answers.dir)}`);
  printLine(`\nNext steps:`);
  printLine(`  cd ${answers.dir}`);
  for (const line of stepsFor(answers, runner, installed)) {
    printLine(line);
  }
}

/** The target-specific commands, one per line. */
function stepsFor(answers: Answers, runner: PackageRunner, installed: boolean): string[] {
  const target = resolveDeployTarget(answers);
  if (target === "docker") {
    return dockerSteps(needsCompose(answers), answers.auth === "password");
  }
  return [
    ...envSteps(answers),
    ...(installed ? [] : [`  ${installCommand(runner)}`]),
    `  ${browserInstallCommand(runner)}   # once; add --with-deps on Linux`,
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
    ...names.map(
      (name) =>
        `  export ${name}=${name === "DATABASE_URL" ? databaseUrlExample(answers.database) : (EXPORT_HINT[name] ?? "...")}`,
    ),
  ];
}

const EXPORT_HINT: Record<string, string> = {
  SHELF_SECRET: `"$(openssl rand -hex 32)"   # keep and reuse it`,
  SHELF_PUBLIC_BASE_URL: `http://localhost:3000`,
  SHELF_ADMIN_PASSWORD: `...   # the admin's password, 12+ characters`,
};

function dockerSteps(compose: boolean, password: boolean): string[] {
  const env = [
    `  export SHELF_SECRET=...      # at least 32 random characters; keep and reuse it`,
    ...(password
      ? [`  export SHELF_ADMIN_PASSWORD=...  # the local admin's password (12+ characters)`]
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
