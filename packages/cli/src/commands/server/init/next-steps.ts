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
  if (target === "docker") {
    return dockerSteps(needsCompose(answers));
  }
  return [`  ${installCommand(runner)}`, `  ${startCommand(runner)}`];
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
