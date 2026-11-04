import prompts from "prompts";
import { printError } from "../../../output.ts";
import { detectInstalledAdapters, type DetectedAdapters } from "../../shared/detect-adapters.ts";
import {
  ADVANCED_ADAPTERS_PROMPT,
  DEPLOY_TARGET_PROMPT,
  PROJECT_PROMPTS,
  AWS_INFRA_PROMPTS,
  AZURE_INFRA_PROMPTS,
  GCP_INFRA_PROMPTS,
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
 * (local and docker) or the fixed reference stack with its follow-ups (aws, azure, gcp).
 * Resolves `null` when the project name or directory is missing (the user cancelled).
 */
export async function collectAnswers(): Promise<Answers | null> {
  // Try to autofill from existing package.json (re-init)
  const cwdPkg = detectInstalledAdapters(process.cwd());

  // Phase 1 (curated path): project + deploy target first. Legacy single-call
  // mocks return the full answer object here — merge progressively so those
  // tests keep passing while interactive users get filtered phase-2 prompts.
  const phase1 = await ask([...PROJECT_PROMPTS, DEPLOY_TARGET_PROMPT]);
  if (!phase1["name"] || !phase1["dir"]) {
    printError("Cancelled.");
    return null;
  }

  const answers = { ...phase1 } as unknown as Answers;
  await askLocalAdapters(answers, cwdPkg);
  await askCloudStack(answers);
  return answers;
}

/** Ask a question set; a cancelled or empty prompt resolves to no answers. */
async function ask(questions: Parameters<typeof prompts>[0]): Promise<Record<string, unknown>> {
  return (await prompts(questions)) ?? {};
}

type LocalPrompt = ReturnType<typeof localInfraPrompts>[number];

/**
 * For a local or docker target, the adapter menu: the advanced toggle, then curated (4 DBs) or the
 * full matrix of database, storage, auth and git questions. Cloud targets pin a stack instead.
 */
async function askLocalAdapters(answers: Answers, detected: DetectedAdapters): Promise<void> {
  const target = resolveDeployTarget(answers);
  if (target !== "local" && target !== "docker") {
    return;
  }
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

type StackField =
  | "awsRegion"
  | "azureLocation"
  | "gcpProjectId"
  | "gcpLocation"
  | "domainName"
  | "samlMetadataUrl"
  | "entraTenantId"
  | "identityTenant";

/**
 * The fixed enterprise reference stack of each cloud target (Postgres plus the cloud's object
 * store; Dockerfiles still generate for the image build), with its follow-up questions and the
 * answers they fill, each with its fallback.
 */
const CLOUD_STACKS: Record<
  string,
  {
    storage: Answers["storage"];
    prompts: Parameters<typeof prompts>[0];
    fields: readonly (readonly [StackField, string | undefined])[];
  }
> = {
  aws: {
    storage: "s3",
    prompts: AWS_INFRA_PROMPTS,
    fields: [
      ["awsRegion", "us-east-1"],
      ["domainName", undefined],
      ["samlMetadataUrl", undefined],
    ],
  },
  azure: {
    storage: "azure",
    prompts: AZURE_INFRA_PROMPTS,
    fields: [
      ["azureLocation", "eastus"],
      ["domainName", undefined],
      ["entraTenantId", undefined],
    ],
  },
  gcp: {
    storage: "gcs",
    prompts: GCP_INFRA_PROMPTS,
    fields: [
      ["gcpProjectId", undefined],
      ["gcpLocation", "us-central1"],
      ["domainName", undefined],
      ["identityTenant", undefined],
    ],
  },
};

/** For an AWS, Azure or GCP target: pin the reference stack, then ask its follow-ups. */
async function askCloudStack(answers: Answers): Promise<void> {
  const stack = CLOUD_STACKS[resolveDeployTarget(answers)];
  if (!stack) {
    return;
  }
  answers.database = "postgres";
  answers.storage = stack.storage;
  answers.docker = true;
  const given = await ask(stack.prompts);
  for (const [field, fallback] of stack.fields) {
    answers[field] = (given[field] as string | undefined) ?? fallback;
  }
}
