import type { ShelfRouter } from "../app-types.ts";
import { serviceWorkerScript } from "../shell/service-worker.ts";

/** Where the worker is served; reachable without a session so the sign-in page can register it. */
export const SERVICE_WORKER_PATH = "/sw.js";

/**
 * Serve the service worker at the root so its scope is `/`. Never sends `Service-Worker-Allowed`:
 * a published Storybook's own worker must stay confined to its build's path (ADR 0048).
 */
export function registerServiceWorker(app: ShelfRouter): void {
  app.get(SERVICE_WORKER_PATH, (c) =>
    c.body(serviceWorkerScript(), 200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
    }),
  );
}
