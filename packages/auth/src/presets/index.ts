/**
 * Auth presets: native social recipes and enterprise OIDC recipes for the
 * shelf auth engine.
 */
export {
  auth0Preset,
  keycloakPreset,
  oktaPreset,
  type EnterpriseClientOptions,
} from "./enterprise.ts";
export {
  cognitoPreset,
  entraPreset,
  githubPreset,
  gitlabPreset,
  googlePreset,
  type SocialClientOptions,
} from "./social.ts";
