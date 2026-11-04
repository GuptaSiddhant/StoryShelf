import prompts from "prompts";
import { printError } from "../../../output.ts";
import { detectInstalledAdapters } from "../../shared/detect-adapters.ts";
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
  const phase1 =
    ((await prompts([...PROJECT_PROMPTS, DEPLOY_TARGET_PROMPT])) as Record<string, unknown>) ?? {};

  if (!phase1["name"] || !phase1["dir"]) {
    printError("Cancelled.");
    return null;
  }

  const answers = { ...phase1 } as unknown as Answers;
  const target = resolveDeployTarget(answers);

  // Local/docker path: advanced toggle, then curated (4 DBs) or full matrix.
  if (target === "local" || target === "docker") {
    const advPhase =
      ((await prompts(ADVANCED_ADAPTERS_PROMPT as never)) as Record<string, unknown>) ?? {};
    const advanced =
      (answers.advancedAdapters as boolean | undefined) ??
      (advPhase["advancedAdapters"] as boolean | undefined) ??
      false;
    answers.advancedAdapters = advanced;

    const localPrompts = localInfraPrompts(advanced).map((prompt) => {
      if (prompt.type !== "select") {
        return prompt;
      }
      // Prefer an already-provided (legacy mock) or detected value as initial.
      const legacy = answers[prompt.name as keyof Answers] as string | undefined;
      const detected = cwdPkg[prompt.name as keyof typeof cwdPkg] as string | undefined;
      const initial = promptInitial(prompt.choices, legacy ?? detected);
      if (initial !== undefined) {
        return { ...prompt, initial };
      }
      return prompt;
    });

    const phase2 = ((await prompts(localPrompts as never)) as Record<string, unknown>) ?? {};
    Object.assign(answers, phase2);
    answers.advancedAdapters = advanced;
    answers.deployTarget ??= target;
  } else {
    // Cloud targets pin the enterprise reference stack — no adapter menu.
    // Merge any legacy single-call mock values first, then force the stack.
    const legacyInfra = { ...phase1 };
    Object.assign(answers, legacyInfra);
  }
  // AWS target: fixed enterprise reference stack (Postgres + S3). Dockerfiles still generate for ECR image builds.
  if (resolveDeployTarget(answers) === "aws") {
    answers.database = "postgres";
    answers.storage = "s3";
    answers.docker = true;
    const awsAnswers = ((await prompts(AWS_INFRA_PROMPTS)) as Record<string, unknown>) ?? {};
    answers.awsRegion = (awsAnswers["awsRegion"] as string | undefined) ?? "us-east-1";
    answers.domainName = (awsAnswers["domainName"] as string | undefined) ?? undefined;
    answers.samlMetadataUrl = (awsAnswers["samlMetadataUrl"] as string | undefined) ?? undefined;
  }

  // Azure target: fixed enterprise reference stack (Postgres + Blob). Dockerfiles still
  // generate for ACR image builds.
  if (resolveDeployTarget(answers) === "azure") {
    answers.database = "postgres";
    answers.storage = "azure";
    answers.docker = true;
    const azureAnswers = ((await prompts(AZURE_INFRA_PROMPTS)) as Record<string, unknown>) ?? {};
    answers.azureLocation = (azureAnswers["azureLocation"] as string | undefined) ?? "eastus";
    answers.domainName = (azureAnswers["domainName"] as string | undefined) ?? undefined;
    answers.entraTenantId = (azureAnswers["entraTenantId"] as string | undefined) ?? undefined;
  }

  // GCP target: fixed enterprise reference stack (Postgres + GCS). Dockerfiles still generate for
  // Artifact Registry image builds.
  if (resolveDeployTarget(answers) === "gcp") {
    answers.database = "postgres";
    answers.storage = "gcs";
    answers.docker = true;
    const gcpAnswers = ((await prompts(GCP_INFRA_PROMPTS)) as Record<string, unknown>) ?? {};
    answers.gcpProjectId = (gcpAnswers["gcpProjectId"] as string | undefined) ?? undefined;
    answers.gcpLocation = (gcpAnswers["gcpLocation"] as string | undefined) ?? "us-central1";
    answers.domainName = (gcpAnswers["domainName"] as string | undefined) ?? undefined;
    answers.identityTenant = (gcpAnswers["identityTenant"] as string | undefined) ?? undefined;
  }

  return answers;
}
