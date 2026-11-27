/** Which step of a render threw, remembered without changing the error that was thrown. */

const steps = new WeakMap<object, string>();

/** The steps of one story render, in order. */
export type RenderStep =
  | "page"
  | "navigate"
  | "ready"
  | "play"
  | "a11y"
  | "settle"
  | "mask"
  | "plan"
  | "screenshot";

/**
 * Run `work`; an error it throws is tagged with `step` unless a step inside it already tagged it, so
 * the innermost step wins. The error itself is rethrown untouched (its class, message and `cause`
 * stay what the retry and timeout checks read).
 */
export async function inStep<T>(step: RenderStep, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (typeof error === "object" && error !== null && !steps.has(error)) steps.set(error, step);
    throw error;
  }
}

/** The step that threw `error`, looking through its causes (a retry wrapper holds the original). */
export function stepOf(error: unknown): RenderStep | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    const step = steps.get(current);
    if (step !== undefined) return step as RenderStep;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
