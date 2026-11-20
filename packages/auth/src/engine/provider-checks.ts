/** Free reachability checks for the configured OIDC providers: one discovery fetch each, no sign-in. */
import type { AuthProviderCheck } from "@storyshelf/core/auth";
import { httpJson, redactUrlForLog } from "@storyshelf/core/utils";
import type { ShelfAuthOptions } from "./types.ts";

const DISCOVERY_TIMEOUT_MS = 2000;

/** The discovery URL of an SSO OIDC connection (its own, else issuer + the well-known path). */
function ssoDiscoveryUrl(oidc: { issuer: string; discoveryUrl?: string }): string {
  return (
    oidc.discoveryUrl ?? `${oidc.issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`
  );
}

/** One discovery fetch; the document must name an issuer. The detail carries the origin only. */
async function checkDiscovery(url: string): Promise<{ ok: boolean; detail?: string }> {
  const origin = redactUrlForLog(url);
  const document = await httpJson<{ issuer?: unknown }>(url, {
    timeoutMs: DISCOVERY_TIMEOUT_MS,
    retries: 1,
  });
  return typeof document.issuer === "string"
    ? { ok: true, detail: `discovery reachable at ${origin}` }
    : { ok: false, detail: `discovery document from ${origin} has no issuer` };
}

function entry(id: string, label: string, url: string): AuthProviderCheck {
  return { id, label, check: async () => await checkDiscovery(url) };
}

/** A check per OIDC provider that has a discovery URL (explicit-endpoint and SAML ones have none). */
export function providerChecksOf(options: ShelfAuthOptions): AuthProviderCheck[] {
  const checks: AuthProviderCheck[] = [];
  for (const provider of options.oauth ?? []) {
    if (provider.discoveryUrl !== undefined) {
      checks.push(entry(provider.id, provider.label, provider.discoveryUrl));
    }
  }
  for (const provider of options.sso?.providers ?? []) {
    if (provider.oidc !== undefined) {
      checks.push(entry(provider.id, provider.label, ssoDiscoveryUrl(provider.oidc)));
    }
  }
  return checks;
}
