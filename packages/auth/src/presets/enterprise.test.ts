import { describe, expect, it } from "vitest";
import { auth0Preset, keycloakPreset, oktaPreset } from "./enterprise.ts";

describe("enterprise presets", () => {
  it("builds the Keycloak discovery config", () => {
    expect(
      keycloakPreset("https://idp.example.com/realms/shelf", {
        clientId: "storyshelf",
        clientSecret: "shh",
      }),
    ).toEqual({
      id: "keycloak",
      label: "Keycloak",
      clientId: "storyshelf",
      clientSecret: "shh",
      discoveryUrl: "https://idp.example.com/realms/shelf/.well-known/openid-configuration",
    });
  });

  it("builds explicit Okta endpoints", () => {
    const preset = oktaPreset({
      domain: "shelf.okta.com",
      authorizationServerId: "default",
      clientId: "id",
    });
    expect(preset.id).toBe("okta");
    expect(preset.authorizationUrl).toBe("https://shelf.okta.com/oauth2/default/v1/authorize");
    expect(preset.tokenUrl).toBe("https://shelf.okta.com/oauth2/default/v1/token");
    expect(preset.userInfoUrl).toBe("https://shelf.okta.com/oauth2/default/v1/userinfo");
  });

  it("builds explicit Auth0 endpoints", () => {
    const preset = auth0Preset({ domain: "shelf.us.auth0.com", clientId: "id" });
    expect(preset.id).toBe("auth0");
    expect(preset.authorizationUrl).toBe("https://shelf.us.auth0.com/authorize");
    expect(preset.tokenUrl).toBe("https://shelf.us.auth0.com/oauth/token");
    expect(preset.userInfoUrl).toBe("https://shelf.us.auth0.com/userinfo");
  });
});
