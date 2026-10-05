/**
 * Native social provider recipes: option bags for Better Auth built-ins.
 *
 * Each preset returns a {@link ShelfSocialProvider} for
 * `createShelfAuth({ social })`. Native providers own their protocol
 * (PKCE, token exchange, profile mapping) — the shelf only supplies
 * credentials, so these recipes are pure config with no network behavior.
 */
import type { ShelfSocialProvider } from "../engine.ts";

/** Client credentials shared by the OAuth social presets. */
export interface SocialClientOptions {
  clientId: string;
  clientSecret?: string;
  label?: string;
}

/** GitHub social login (`github`). */
export function githubPreset(options: SocialClientOptions): ShelfSocialProvider {
  return {
    id: "github",
    label: options.label ?? "GitHub",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
  };
}

/** GitLab social login (`gitlab`; `issuer` for self-managed instances). */
export function gitlabPreset(
  options: SocialClientOptions & { issuer?: string },
): ShelfSocialProvider {
  return {
    id: "gitlab",
    label: options.label ?? "GitLab",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    extra: { issuer: options.issuer },
  };
}

/** Google social login (`google`). */
export function googlePreset(options: SocialClientOptions): ShelfSocialProvider {
  return {
    id: "google",
    label: options.label ?? "Google",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
  };
}

/** Microsoft Entra ID social login (`microsoft`; `tenantId` or `common`). */
export function entraPreset(
  options: SocialClientOptions & { tenantId?: string },
): ShelfSocialProvider {
  return {
    id: "microsoft",
    label: options.label ?? "Microsoft",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    extra: { tenantId: options.tenantId },
  };
}

/** Amazon Cognito User Pool social login (`cognito`). */
export function cognitoPreset(options: {
  domain: string;
  region: string;
  userPoolId: string;
  clientId: string;
  clientSecret?: string;
  label?: string;
}): ShelfSocialProvider {
  return {
    id: "cognito",
    label: options.label ?? "Cognito",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    extra: { domain: options.domain, region: options.region, userPoolId: options.userPoolId },
  };
}
