/** Cache key for an insight: identical evidence + prompt + model is a free hit. */
import { sha256 } from "../utils/hash.ts";

/** Parts that define whether a cached insight is still valid. */
export interface InputHashParts {
  evidenceText: string;
  /** Image digests, in send order. */
  imageDigests: string[];
  promptVersion: string;
  task: string;
  profile: string;
  model: string;
}

/** Hash the final assembled evidence plus prompt/task/profile/model. */
export function computeInputHash(parts: InputHashParts): string {
  return sha256(
    JSON.stringify([
      parts.promptVersion,
      parts.task,
      parts.profile,
      parts.model,
      parts.imageDigests,
      parts.evidenceText,
    ]),
  );
}
