import { describe, expect, it } from "vitest";
import { createOAuthAuth } from "./index.ts";
import { auth0Preset, cognitoPreset, entraPreset, keycloakPreset, oktaPreset } from "./presets.ts";

const basePresetOptions = {
  clientId: "client-id",
  clientSecret: "client-secret",
  secret: "signing-secret",
  redirectUrl: "https://storyshelf.example.com/api/v1/auth/callback",
};

describe("provider presets", () => {
  it("keycloakPreset keeps the realm issuer", () => {
    const preset = keycloakPreset("https://id.example.com/realms/team", basePresetOptions);
    expect(preset.issuer).toBe("https://id.example.com/realms/team");
    expect(preset.authorizationEndpoint).toBeUndefined();
  });

  it("oktaPreset builds v1 endpoints", () => {
    const preset = oktaPreset("id.example.okta.com", "default", basePresetOptions);
    expect(preset.issuer).toBe("https://id.example.okta.com/oauth2/default");
    expect(preset.tokenEndpoint).toBe("https://id.example.okta.com/oauth2/default/v1/token");
  });

  it("entraPreset builds tenant endpoints", () => {
    const preset = entraPreset("tenant-id", basePresetOptions);
    expect(preset.issuer).toBe("https://login.microsoftonline.com/tenant-id/v2.0");
    expect(preset.userinfoEndpoint).toBe("https://graph.microsoft.com/oidc/userinfo");
  });

  it("cognitoPreset builds pool endpoints", () => {
    const preset = cognitoPreset("us-east-1", "us-east-1_abc", basePresetOptions);
    expect(preset.issuer).toBe("https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc");
    expect(preset.tokenEndpoint).toBe(
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc/oauth2/token",
    );
  });

  it("auth0Preset builds domain endpoints", () => {
    const preset = auth0Preset("tenant.us.auth0.com", basePresetOptions);
    expect(preset.tokenEndpoint).toBe("https://tenant.us.auth0.com/oauth/token");
  });

  it("preset endpoints flow into the login url", () => {
    const auth = createOAuthAuth(entraPreset("tenant-id", basePresetOptions));
    const url = new URL(auth.loginUrl("s"));
    expect(url.hostname).toBe("login.microsoftonline.com");
    expect(url.pathname).toBe("/tenant-id/oauth2/v2.0/authorize");
  });
});
