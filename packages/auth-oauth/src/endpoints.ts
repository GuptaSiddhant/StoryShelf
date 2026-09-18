import type { OAuthAuthOptions, OidcEndpoints } from "./types.ts";

/** Keycloak endpoint layout (the historic default). */
function keycloakEndpoints(issuer: string): OidcEndpoints {
  return {
    authorizationEndpoint: `${issuer}/protocol/openid-connect/auth`,
    tokenEndpoint: `${issuer}/protocol/openid-connect/token`,
    userinfoEndpoint: `${issuer}/protocol/openid-connect/userinfo`,
  };
}

/** Endpoints from explicit overrides, falling back to the Keycloak layout. */
export function staticEndpoints(options: OAuthAuthOptions): OidcEndpoints {
  const legacy = keycloakEndpoints(options.issuer);
  return {
    authorizationEndpoint: options.authorizationEndpoint ?? legacy.authorizationEndpoint,
    tokenEndpoint: options.tokenEndpoint ?? legacy.tokenEndpoint,
    userinfoEndpoint: options.userinfoEndpoint ?? legacy.userinfoEndpoint,
  };
}

interface DiscoveryDocument {
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
}

/** Merge discovered endpoints over explicit overrides and the static fallback. */
function mergeDiscovered(
  options: OAuthAuthOptions,
  fallback: OidcEndpoints,
  document: DiscoveryDocument,
): OidcEndpoints {
  return {
    authorizationEndpoint:
      options.authorizationEndpoint ??
      document.authorization_endpoint ??
      fallback.authorizationEndpoint,
    tokenEndpoint: options.tokenEndpoint ?? document.token_endpoint ?? fallback.tokenEndpoint,
    userinfoEndpoint:
      options.userinfoEndpoint ?? document.userinfo_endpoint ?? fallback.userinfoEndpoint,
  };
}

/** Fetch and parse an OIDC Discovery document, or null when unavailable. */
async function fetchDiscovery(documentUrl: string): Promise<DiscoveryDocument | null> {
  try {
    const response = await fetch(documentUrl);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as DiscoveryDocument;
  } catch {
    return null;
  }
}

/** Resolve endpoints via OIDC Discovery, caching into `onDiscovered`. */
export async function resolveEndpoints(
  options: OAuthAuthOptions,
  onDiscovered: (endpoints: OidcEndpoints) => void,
): Promise<OidcEndpoints> {
  const fallback = staticEndpoints(options);
  const discoveryUrl =
    options.discoveryUrl === undefined
      ? `${options.issuer}/.well-known/openid-configuration`
      : options.discoveryUrl;
  if (discoveryUrl === null) {
    return fallback;
  }
  const document = await fetchDiscovery(discoveryUrl);
  if (!document) {
    return fallback;
  }
  const resolved = mergeDiscovered(options, fallback, document);
  onDiscovered(resolved);
  return resolved;
}

/** Cached endpoint discovery with a static fallback. */
export function createEndpointDiscovery(options: OAuthAuthOptions): {
  current: () => OidcEndpoints;
  resolve: () => Promise<OidcEndpoints>;
  warm: () => Promise<void>;
} {
  let discovered: OidcEndpoints | null = null;
  const current = (): OidcEndpoints => discovered ?? staticEndpoints(options);
  const resolve = async (): Promise<OidcEndpoints> =>
    await resolveEndpoints(options, (fresh) => {
      discovered = fresh;
    });
  return {
    current,
    resolve,
    warm: async () => {
      await resolve();
    },
  };
}
