import { describe, expect, it } from "vitest";
import { createOAuthAuth } from "./index.ts";
import { entraPreset } from "./presets.ts";

describe("createOAuthAuth barrel", () => {
  it("exposes the factory, presets, and option types from the entry point", async () => {
    const barrel = await import("./index.ts");
    for (const name of [
      "createOAuthAuth",
      "keycloakPreset",
      "oktaPreset",
      "entraPreset",
      "cognitoPreset",
      "auth0Preset",
    ] as const) {
      expect(typeof barrel[name]).toBe("function");
    }
  });

  it("builds a working adapter from a preset", () => {
    const auth = createOAuthAuth(
      entraPreset("tenant-id", {
        clientId: "client-id",
        clientSecret: "client-secret",
        secret: "signing-secret",
        redirectUrl: "https://storyshelf.example.com/api/v1/auth/callback",
      }),
    );
    expect(auth.metadata.kind).toBe("oauth");
    expect(typeof auth.handleCallback).toBe("function");
  });
});
