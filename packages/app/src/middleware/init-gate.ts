import type { AdapterInitResult } from "@storyshelf/core/adapter/init";
import type { ShelfOptions } from "@storyshelf/core/config";
import type { Context, Next } from "hono";
import type { QueueWiring } from "../capture-setup.ts";
import type { ServerRuntime } from "../runtime.ts";

export interface MiddlewareWiring extends ServerRuntime, QueueWiring {
  options: ShelfOptions;
  getReady: () => Promise<AdapterInitResult>;
}

/** Failures safe to expose on the init gate's 503 (no secrets). */
function publicFailures(
  result: AdapterInitResult,
): { category: string; kind: string; error: string }[] {
  return result.failures.map((failure) => ({
    category: failure.category,
    kind: failure.kind,
    error: failure.error,
  }));
}

/**
 * Block requests until adapter init settles; answer 503 with the per-adapter
 * failures when init failed. Health probes are exempt (they report init
 * state themselves instead of being masked by the gate).
 */
export function initGate(getReady: () => Promise<AdapterInitResult>) {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.req.path === "/api/v1/health") {
      await next();
      return;
    }
    const result = await getReady();
    if (!result.ok) {
      return c.json(
        { error: "Adapters failed to initialize", failures: publicFailures(result) },
        503,
      );
    }
    await next();
  };
}
