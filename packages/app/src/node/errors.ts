import { sanitizeErrorText } from "@storyshelf/core/utils";
import type { ShutdownTrigger } from "./types.ts";

/** Longest message a start-up error keeps. */
const MAX_MESSAGE = 500;

/** Thrown by `startServer` when a signal, an abort or `close()` stopped it before it was listening. */
export class StartInterruptedError extends Error {
  override readonly name = "StartInterruptedError";
  readonly trigger: ShutdownTrigger;

  constructor(trigger: ShutdownTrigger) {
    super(`StoryShelf start-up was interrupted (${trigger})`);
    this.trigger = trigger;
  }
}

/**
 * The start-up's primary error, safe to print: the error itself when its message holds no secret
 * (so its class, code and stack survive), else a copy with a redacted message and no cause.
 */
export function sanitizedStartError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(sanitizeErrorText(String(error), MAX_MESSAGE));
  }
  const message = sanitizeErrorText(error.message, MAX_MESSAGE);
  if (message === error.message) {
    return error;
  }
  const copy = new Error(message);
  copy.name = error.name;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? Object.assign(copy, { code }) : copy;
}
