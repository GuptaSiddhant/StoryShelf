import { basename, resolve } from "node:path";
import prompts from "prompts";
import { printError } from "../../../output.ts";
import { detectInstalledAdapters, type DetectedAdapters } from "../../shared/detect-adapters.ts";
import {
  ADVANCED_ADAPTERS_PROMPT,
  DEPLOY_TARGET_PROMPT,
  PROJECT_PROMPTS,
  localInfraPrompts,
} from "../prompts.ts";
import { resolveDeployTarget, type Answers } from "./answers.ts";

export function promptInitial(choices: { value: string }[], value?: string): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const idx = choices.findIndex((c) => c.value === value);
  if (idx === -1) return undefined;
  return idx;
}

/**
 * Ask the questions and merge the answers: project and deploy target first, then the adapter menu
 * (local and docker).
 * Resolves `null` when the project name or directory is missing (the user cancelled).
 */
export async function collectAnswers(dir?: string): Promise<Answers | null> {
  // Try to autofill from existing package.json (re-init)
  const cwdPkg = detectInstalledAdapters(process.cwd());

  // Phase 1 (curated path): project + deploy target first. Legacy single-call
  // mocks return the full answer object here — merge progressively so those
  // tests keep passing while interactive users get filtered phase-2 prompts.
  const phase1 = await askProject(dir);
  if (!phase1["name"] || !phase1["dir"]) {
    printError("Cancelled.");
    return null;
  }

  const answers = { ...phase1 } as unknown as Answers;
  await askLocalAdapters(answers, cwdPkg);
  return answers;
}

/** The project questions when `--dir` is given: no directory question, and the name defaults to the directory's. */
function promptsForDir(dir: string): typeof PROJECT_PROMPTS {
  return PROJECT_PROMPTS.filter((prompt) => prompt.name !== "dir").map((prompt) =>
    prompt.type === "text" && prompt.name === "name"
      ? {
          type: prompt.type,
          name: prompt.name,
          message: prompt.message,
          initial: basename(resolve(dir)),
        }
      : prompt,
  );
}

/** The project name and deploy target; `--dir` answers the directory question. */
async function askProject(dir?: string): Promise<Record<string, unknown>> {
  const projectPrompts = dir ? promptsForDir(dir) : PROJECT_PROMPTS;
  const answers = await ask([...projectPrompts, DEPLOY_TARGET_PROMPT]);
  return dir ? { ...answers, dir } : answers;
}

/** Ask a question set; a cancelled or empty prompt resolves to no answers. */
async function ask(questions: Parameters<typeof prompts>[0]): Promise<Record<string, unknown>> {
  return (await prompts(questions)) ?? {};
}

type LocalPrompt = ReturnType<typeof localInfraPrompts>[number];

/**
 * For a local or docker target, the adapter menu: the advanced toggle, then curated (4 DBs) or the
 * full matrix of database, storage, auth and git questions.
 */
async function askLocalAdapters(answers: Answers, detected: DetectedAdapters): Promise<void> {
  const target = resolveDeployTarget(answers);
  const advPhase = await ask(ADVANCED_ADAPTERS_PROMPT);
  const advanced =
    answers.advancedAdapters ?? (advPhase["advancedAdapters"] as boolean | undefined) ?? false;
  answers.advancedAdapters = advanced;
  const localPrompts = localInfraPrompts(advanced).map((prompt) =>
    withInitial(prompt, answers, detected),
  );
  Object.assign(answers, await ask(localPrompts));
  answers.advancedAdapters = advanced;
  answers.deployTarget ??= target;
}

/** Prefer an already-provided (legacy mock) or detected value as the select's initial choice. */
function withInitial(
  prompt: LocalPrompt,
  answers: Answers,
  detected: DetectedAdapters,
): LocalPrompt {
  if (prompt.type !== "select") {
    return prompt;
  }
  const legacy = answers[prompt.name as keyof Answers] as string | undefined;
  const found = detected[prompt.name as keyof DetectedAdapters] as string | undefined;
  const initial = promptInitial(prompt.choices, legacy ?? found);
  return initial === undefined ? prompt : { ...prompt, initial };
}
