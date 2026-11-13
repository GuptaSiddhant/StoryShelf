import { overrideGuardedNetwork } from "../utils/outbound-fetch.ts";
import { overrideOutboundResolver } from "../utils/outbound.ts";

/**
 * Let project-set requests reach the global `fetch` a test stubbed: every host resolves to a public
 * address and the pinned transport is replaced by `fetch`. The outbound policy still applies to
 * the URL itself. Returns the restore function; call it in `afterEach`.
 */
export function publicNetworkForTests(): () => void {
  const restoreResolver = overrideOutboundResolver(async () => [
    { address: "93.184.216.34", family: 4 },
  ]);
  const restoreTransport = overrideGuardedNetwork({
    transport: async (target, init) =>
      await fetch(target, { method: init.method, headers: init.headers, body: init.body }),
  });
  return () => {
    restoreTransport();
    restoreResolver();
  };
}
