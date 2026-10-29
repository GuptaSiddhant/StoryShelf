/** A narrowly classified page failure that may be retried on a fresh context. */
export class TransientCaptureError extends Error {
  readonly phase: "navigation" | "screenshot" | "crash";

  constructor(phase: "navigation" | "screenshot" | "crash", cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "TransientCaptureError";
    this.phase = phase;
  }
}

/** Only Playwright timeouts from the specified operation are eligible. */
export async function capturePhase<T>(
  phase: "navigation" | "screenshot",
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new TransientCaptureError(phase, error);
    }
    throw error;
  }
}
