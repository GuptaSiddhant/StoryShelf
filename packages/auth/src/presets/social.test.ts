import { describe, expect, it } from "vitest";
import { cognitoPreset, entraPreset, githubPreset, gitlabPreset, googlePreset } from "./social.ts";

describe("social presets", () => {
  it("builds the GitHub provider bag", () => {
    expect(githubPreset({ clientId: "id", clientSecret: "shh" })).toEqual({
      id: "github",
      label: "GitHub",
      clientId: "id",
      clientSecret: "shh",
    });
  });

  it("builds Google with a custom label", () => {
    const preset = googlePreset({ clientId: "id", clientSecret: "shh", label: "Work Google" });
    expect(preset.id).toBe("google");
    expect(preset.label).toBe("Work Google");
  });

  it("passes the self-managed issuer through for GitLab", () => {
    const preset = gitlabPreset({ clientId: "id", issuer: "https://git.example.com" });
    expect(preset.id).toBe("gitlab");
    expect(preset.extra?.["issuer"]).toBe("https://git.example.com");
  });

  it("passes the tenant through for Entra", () => {
    const preset = entraPreset({ clientId: "id", tenantId: "tenant" });
    expect(preset.id).toBe("microsoft");
    expect(preset.extra?.["tenantId"]).toBe("tenant");
  });

  it("builds the Cognito pool bag", () => {
    const preset = cognitoPreset({
      domain: "app.auth.us-east-1.amazoncognito.com",
      region: "us-east-1",
      userPoolId: "pool",
      clientId: "id",
    });
    expect(preset.id).toBe("cognito");
    expect(preset.extra).toEqual({
      domain: "app.auth.us-east-1.amazoncognito.com",
      region: "us-east-1",
      userPoolId: "pool",
    });
  });
});
