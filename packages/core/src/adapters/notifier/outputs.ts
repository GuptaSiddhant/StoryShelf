/**
 * What a git target posts beyond its merge gate (ADR 0054, decision 10). A repository link stores
 * its project's choices, capped by its connection's ceiling; a per-project channel posts everything,
 * as it always did. The gate itself is not a choice: it posts while the link exists.
 */

/** When the pull-request comment is kept. */
export type CommentMode = "always" | "on-changes" | "off";

/** The outputs a target posts besides the gate. */
export interface StateOutputs {
  /** `<prefix>/storybook`, the informational Storybook status. */
  storybook: boolean;
  /** The pull-request comment: always, only for a build with visual changes, or never. */
  comment: CommentMode;
  /** Per-snapshot annotations on the `testing` check run. */
  annotations: boolean;
}

/** Everything on: what a per-project channel posts, and a new link's default. */
export const ALL_OUTPUTS: StateOutputs = Object.freeze({
  storybook: true,
  comment: "always",
  annotations: true,
});

const COMMENT_MODES: ReadonlySet<string> = new Set(["always", "on-changes", "off"]);

/** Whether `value` is a {@link CommentMode}. */
export function isCommentMode(value: unknown): value is CommentMode {
  return typeof value === "string" && COMMENT_MODES.has(value);
}

/** Read stored outputs (JSON); a missing or malformed field takes its default from {@link ALL_OUTPUTS}. */
export function parseOutputs(text: string | null | undefined): StateOutputs {
  const stored = parseObject(text);
  return {
    storybook: typeof stored["storybook"] === "boolean" ? stored["storybook"] : true,
    comment: isCommentMode(stored["comment"]) ? stored["comment"] : "always",
    annotations: typeof stored["annotations"] === "boolean" ? stored["annotations"] : true,
  };
}

/**
 * Cap a link's choices by what its connection may post: a ceiling without the pull-request
 * permission turns the comment off. Check runs (and with them annotations) are always allowed.
 */
export function cappedOutputs(
  choices: StateOutputs,
  ceiling: { pullRequests: boolean },
): StateOutputs {
  return ceiling.pullRequests ? choices : { ...choices, comment: "off" };
}

function parseObject(text: string | null | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text ?? "{}");
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
