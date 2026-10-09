/** setup/health/teardown: free checks only (never a billed call). */
import type { AiHealth } from "@storyshelf/core/ai";
import type { LanguageModel } from "ai";
import { effectiveSlot, modelId } from "./client.ts";
import type { AiState } from "./state.ts";
import { registerOtelOnce } from "./telemetry.ts";

const SUPPORTED_SPECS = new Set(["v2", "v3", "v4"]);

function eachModel(state: AiState): LanguageModel[] {
  const models: LanguageModel[] = [];
  for (const profile of Object.values(state.profiles)) {
    for (const task of ["triage", "health"] as const) {
      models.push(effectiveSlot(profile, task).model);
    }
    if (profile.models?.vision) {
      models.push(effectiveSlot(profile, "triage").model);
    }
  }
  return models;
}

/** Models whose specification version the pinned `ai` core cannot drive. */
export function unsupportedModels(state: AiState): string[] {
  return eachModel(state)
    .filter(
      (model) => typeof model !== "string" && !SUPPORTED_SPECS.has(model.specificationVersion),
    )
    .map((model) => modelId(model));
}

/** Boot checks: spec versions, then OTEL registration when the host enabled it. */
export async function setup(state: AiState, otelEnabled: boolean): Promise<void> {
  const bad = unsupportedModels(state);
  if (bad.length > 0) {
    throw new Error(
      `@storyshelf/ai: unsupported model specification version for ${bad.join(", ")} (align provider packages with the pinned ai core)`,
    );
  }
  if (otelEnabled) {
    registerOtelOnce();
  }
  await Promise.resolve();
}

/** Liveness: configuration is present; no inference is run. */
export async function health(state: AiState): Promise<AiHealth> {
  await Promise.resolve();
  const bad = unsupportedModels(state);
  return bad.length === 0
    ? { ok: true }
    : { ok: false, detail: `unsupported model specification: ${bad.join(", ")}` };
}
