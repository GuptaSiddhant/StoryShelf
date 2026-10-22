/** The capture targets a project can pick, from what the runner offers (ADR 0007, decision 7). */
import {
  BROWSER_NAMES,
  unavailableReason,
  type CaptureTarget,
  type RunnerTarget,
} from "@storyshelf/core/adapter/capture-runner";
import { targetLabel } from "../targets.ts";

/** One selectable target. */
export interface TargetChoice {
  value: string;
  label: string;
}

/** What the capture settings offer. */
export interface TargetChoices {
  /** Targets that can be picked now, plus the project's own (so saving never silently drops one). */
  choices: TargetChoice[];
  /** Offered but not selectable, with why (`firefox: declared, not installed`). */
  unavailable: string[];
}

/**
 * Selectable targets: every ready one; a project's current target that is no longer ready stays,
 * marked, so the form round-trips it. Without a runner list every engine is offered.
 */
export function targetChoices(
  offered: readonly RunnerTarget[] | undefined,
  current: readonly CaptureTarget[],
): TargetChoices {
  if (offered === undefined) {
    return {
      choices: BROWSER_NAMES.map((name) => ({ value: name, label: targetLabel(name) })),
      unavailable: [],
    };
  }
  const ready = offered.filter((entry) => unavailableReason(entry.status) === null);
  const choices = ready.map((entry) => ({
    value: entry.target,
    label: targetLabel(entry.target),
  }));
  for (const target of current) {
    if (!choices.some((choice) => choice.value === target)) {
      choices.push({ value: target, label: `${targetLabel(target)} (not available)` });
    }
  }
  const unavailable = offered.flatMap((entry) => {
    const reason = unavailableReason(entry.status);
    return reason === null ? [] : [`${entry.target}: ${reason}`];
  });
  return { choices, unavailable };
}
