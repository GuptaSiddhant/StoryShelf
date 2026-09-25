import type { AdapterSetupResult } from "@storyshelf/core/adapter/setup";
import type { ShelfOptions } from "@storyshelf/core/config";
import type { Context, Next } from "hono";
import type { QueueWiring } from "../capture-setup.ts";
import type { ServerRuntime } from "../runtime.ts";

export interface MiddlewareWiring extends ServerRuntime, QueueWiring {
  options: ShelfOptions;
  getReady: () => Promise<AdapterSetupResult>;
}

/** Failures safe to expose on the setup gate's 503 (no secrets). */
function publicFailures(
  result: AdapterSetupResult,
): { category: string; kind: string; error: string }[] {
  return result.failures.map((failure) => ({
    category: failure.category,
    kind: failure.kind,
    error: failure.error,
  }));
}

/**
 * Block requests until adapter setup settles; answer 503 with the per-adapter
 * failures when setup failed. Health probes and the admin System page are
 * exempt (they report setup state themselves instead of being masked by
 * the gate — both are site-admin-gated where it matters).
 */
export function setupGate(getReady: () => Promise<AdapterSetupResult>) {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.req.path === "/api/v1/health" || c.req.path === "/admin") {
      await next();
      return;
    }
    const result = await getReady();
    if (!result.ok) {
      return c.json({ error: "Adapters failed setup", failures: publicFailures(result) }, 503);
    }
    await next();
  };
}
