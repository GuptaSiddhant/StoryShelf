import { describe, expect, it } from "vitest";
import {
  samlPreset,
  ssoAuth0Preset,
  ssoCallbackUrls,
  ssoEntraPreset,
  ssoGooglePreset,
  ssoKeycloakPreset,
  ssoOktaPreset,
} from "./sso.ts";

describe("sso recipes", () => {
  it("builds the Keycloak OIDC entry with discovery", () => {
    expect(
      ssoKeycloakPreset("https://idp.example.com/realms/shelf", {
        domain: "example.com",
        clientId: "storyshelf",
        clientSecret: "shh",
      }),
    ).toEqual({
      id: "keycloak",
      label: "Keycloak",
      domain: "example.com",
      oidc: {
        issuer: "https://idp.example.com/realms/shelf",
        clientId: "storyshelf",
        clientSecret: "shh",
      },
    });
  });

  it("builds explicit Okta and Auth0 issuers", () => {
    const okta = ssoOktaPreset({
      domain: "shelf.okta.com",
      authorizationServerId: "default",
      clientId: "id",
    });
    expect(okta.oidc?.issuer).toBe("https://shelf.okta.com/oauth2/default");
    const auth0 = ssoAuth0Preset({
      domain: "acme.example",
      tenant: "shelf.us.auth0.com",
      clientId: "id",
    });
    expect(auth0.oidc?.issuer).toBe("https://shelf.us.auth0.com/");
    expect(auth0.domain).toBe("acme.example");
  });

  it("builds Google Workspace and Entra entries", () => {
    const google = ssoGooglePreset({ domain: "acme.example", clientId: "id" });
    expect(google.id).toBe("google-workspace");
    expect(google.oidc?.issuer).toBe("https://accounts.google.com");
    const entra = ssoEntraPreset({ domain: "acme.example", tenantId: "tenant", clientId: "id" });
    expect(entra.oidc?.issuer).toBe("https://login.microsoftonline.com/tenant/v2.0");
  });

  it("builds the SAML entry from explicit fields", () => {
    expect(
      samlPreset({
        id: "acme-saml",
        label: "Acme",
        domain: "example.com",
        issuer: "http://localhost:3000",
        entryPoint: "https://idp.example.com/sso",
        cert: "CERT",
        entityID: "https://idp.example.com/metadata",
      }).saml,
    ).toEqual({
      issuer: "http://localhost:3000",
      entryPoint: "https://idp.example.com/sso",
      cert: "CERT",
      entityID: "https://idp.example.com/metadata",
    });
  });

  it("prefers metadata XML and rejects an under-specified IdP", () => {
    const entry = samlPreset({
      domain: "example.com",
      issuer: "http://localhost:3000",
      entryPoint: "https://idp.example.com/sso",
      metadataXml: "<EntityDescriptor/>",
    });
    expect(entry.saml?.metadataXml).toBe("<EntityDescriptor/>");
    expect(entry.saml?.entityID).toBeUndefined();
    expect(() =>
      samlPreset({
        domain: "example.com",
        issuer: "http://localhost:3000",
        entryPoint: "https://idp.example.com/sso",
      }),
    ).toThrow(/entityID or metadataXml/u);
  });

  it("builds IdP callback URLs", () => {
    expect(ssoCallbackUrls("http://localhost:3000/", "acme-saml")).toEqual({
      acs: "http://localhost:3000/api/auth/sso/saml2/sp/acs/acme-saml",
      metadata: "http://localhost:3000/api/auth/sso/saml2/sp/metadata?providerId=acme-saml",
      oidcCallback: "http://localhost:3000/api/auth/sso/callback/acme-saml",
    });
  });

  it("passes group sync options through OIDC and SAML recipes", () => {
    const oidc = ssoKeycloakPreset("https://idp.example.com/realms/shelf", {
      domain: "example.com",
      clientId: "shelf",
      groupsClaim: ["groups", "cognito:groups"],
      adminGroups: ["shelf-admins"],
    });
    expect(oidc.groups).toEqual({
      claim: ["groups", "cognito:groups"],
      admins: ["shelf-admins"],
    });

    const saml = samlPreset({
      domain: "example.com",
      issuer: "http://localhost:3000",
      entryPoint: "https://idp.example.com/sso",
      entityID: "https://idp.example.com/metadata",
      groupsAttribute: "http://schemas.example.com/groups",
      adminGroups: ["Acme Admins"],
    });
    expect(saml.groups).toEqual({
      claim: ["http://schemas.example.com/groups"],
      admins: ["Acme Admins"],
    });
  });

  it("omits group sync unless configured", () => {
    const oidc = ssoKeycloakPreset("https://idp.example.com/realms/shelf", {
      domain: "example.com",
      clientId: "shelf",
    });
    expect(oidc.groups).toBeUndefined();
    const saml = samlPreset({
      domain: "example.com",
      issuer: "http://localhost:3000",
      entryPoint: "https://idp.example.com/sso",
      entityID: "https://idp.example.com/metadata",
    });
    expect(saml.groups).toBeUndefined();
  });
});
