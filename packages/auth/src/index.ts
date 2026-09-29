/**
 * StoryShelf Better Auth engine: opaque database bridge, shelf factory,
 * and auth presets over Better Auth protocol plumbing.
 *
 * Domain ownership stays with StoryShelf (users, memberships, invites,
 * UI); Better Auth owns OIDC/SAML/WebAuthn/TOTP wire protocols.
 */
export { baseAuthDateFields, baseAuthTables } from "./auth-tables.ts";
export {
  authUserPg,
  authSessionPg,
  authAccountPg,
  authVerificationPg,
  authPasskeyPg,
  authSsoProviderPg,
  baseAuthTablesPg,
  baseAuthDateFieldsPg,
} from "./auth-tables-pg.ts";
export { ensurePasswordAdmin, type PasswordAdminInput } from "./bootstrap.ts";
export {
  authOptionsSchema,
  parseEnvRef,
  resolveAuthOptions,
  type RawShelfAuthOptions,
  type ResolveSecrets,
} from "./config.ts";
export { createShelfDbBridge, type AuthBridgeSchema } from "./db-bridge.ts";
export type {
  Auth,
  EngineLoginMethod,
  EngineLoginMethodKind,
  EnginePasskeyInfo,
  EngineSessionInfo,
} from "@storyshelf/core/auth";
export {
  ENGINE_PROVIDER_ID,
  createShelfAuth,
  type EngineSessionUser,
  type ShelfAuth,
  type ShelfAuthInstance,
  type ShelfAuthOptions,
  type ShelfOAuthProvider,
  type ShelfPasskeyOptions,
  type ShelfSocialProvider,
  type ShelfSSOOidc,
  type ShelfSSOGroupSync,
  type ShelfSSOOptions,
  type ShelfSSOProvider,
  type ShelfSSOSaml,
} from "./engine.ts";
export {
  DEFAULT_GROUP_CLAIM,
  extractGroups,
  provisionHook,
  resolveSiteRole,
  syncSsoGroups,
  type GroupProvisionData,
  type SsoGroupSyncInput,
} from "./groups.ts";
export {
  acceptInvite,
  issueInvite,
  MIN_PASSWORD_LENGTH,
  verifyInvite,
  type AcceptInviteInput,
  type InviteTokenInput,
  type IssueInviteInput,
} from "./invites.ts";
export {
  auth0Preset,
  cognitoPreset,
  entraPreset,
  githubPreset,
  gitlabPreset,
  googlePreset,
  keycloakPreset,
  oktaPreset,
  type EnterpriseClientOptions,
  type SocialClientOptions,
} from "./presets/index.ts";
export {
  samlPreset,
  ssoAuth0Preset,
  ssoCallbackUrls,
  ssoEntraPreset,
  ssoGooglePreset,
  ssoKeycloakPreset,
  ssoOktaPreset,
  type SAMLGroupOptions,
  type SAMLIdPOptions,
  type SSOClientOptions,
} from "./presets/sso.ts";
export { hasPasswordCredential, listUserPasskeys } from "./passkeys.ts";
export { listUserSessions, unsignedToken } from "./sessions.ts";
