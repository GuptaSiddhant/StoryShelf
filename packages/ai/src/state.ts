import type { AiBudget } from "@storyshelf/core/ai";
/** Immutable configuration state shared by the Ai operations. */
import type { EvidenceLimits } from "@storyshelf/core/insights";
import type { ProfileConfig } from "./types.ts";

/** Resolved, validated instance state. */
export interface AiState {
  profiles: Record<string, ProfileConfig>;
  defaultProfile: string;
  budget: AiBudget;
  limits: Partial<EvidenceLimits>;
}
