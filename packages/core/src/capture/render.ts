/** Render one engine's pass with a budget; shared by the orchestrator's browser loop. */
import type { Logger } from "pino";
import type { BrowserName, CaptureRunner, RenderResult } from "../adapters/capture-runner.ts";

/** Default budget for one render call before the orchestrator cancels it. */
export const RENDER_TIMEOUT_MS = 15 * 60_000;

/** Failure error text cap (persisted rows and logs stay bounded). */
const FAILURE_ERROR_MAX = 500;

/** Render input assembled by the orchestrator for one build. */
export interface RenderRequest {
  buildId: string;
  storybookDir: string;
  stories: Parameters<CaptureRunner["render"]>[0]["stories"];
  viewports: Parameters<CaptureRunner["render"]>[0]["viewports"];
  logger: Logger | undefined;
  executePlay: boolean;
  playTimeoutMs: number;
  runA11y: boolean;
  browser: BrowserName;
}

/** Cap failure error text so one chatty runner cannot flood rows and logs. */
function capFailures(result: RenderResult): RenderResult {
  return {
    captures: result.captures,
    failures: result.failures.map((failure) => ({
      ...failure,
      error:
        failure.error.length > FAILURE_ERROR_MAX
          ? failure.error.slice(0, FAILURE_ERROR_MAX)
          : failure.error,
    })),
  };
}

/** Render with a timeout; cancels the runner when the budget expires. */
export async function renderWithTimeout(
  runner: CaptureRunner,
  request: RenderRequest,
  timeoutMs: number,
): Promise<RenderResult> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Render timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  timer?.unref?.();
  try {
    return capFailures(await Promise.race([runner.render(request), timeout]));
  } catch (error) {
    if (timedOut) {
      await runner.cancel(request.buildId).catch(() => {});
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
