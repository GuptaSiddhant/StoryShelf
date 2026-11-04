import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { BetterAuthPlugin } from "better-auth";
import { describe, expect, it } from "vitest";
import {
  assertNoReservedEndpointCollision,
  buildPlugins,
  buildSocialProviders,
  describeLoginMethods,
} from "./login-methods.ts";
import type { ShelfAuthOptions } from "./types.ts";

const db = {} as DatabaseAdapter;

function options(overrides: Partial<ShelfAuthOptions> = {}): ShelfAuthOptions {
  return { db, secret: "s".repeat(32), baseURL: "https://shelf.example.com", ...overrides };
}

const OAUTH = { id: "keycloak", label: "Keycloak", clientId: "c" };

describe("describeLoginMethods", () => {
  it("is email/password only by default", () => {
    expect(describeLoginMethods(options())).toEqual([
      { kind: "password", id: "password", label: "Email" },
    ]);
  });

  it("drops password when email/password is off", () => {
    expect(describeLoginMethods(options({ emailPassword: false }))).toEqual([]);
  });

  it("lists password, passkey, social, oauth and sso in that order", () => {
    const methods = describeLoginMethods(
      options({
        passkeys: {},
        social: [{ id: "github", label: "GitHub", clientId: "g" }],
        oauth: [OAUTH],
        sso: {
          providers: [
            {
              id: "okta",
              label: "Okta",
              domain: "example.com",
              oidc: { issuer: "i", clientId: "c" },
            },
          ],
        },
      }),
    );
    expect(methods.map((method) => `${method.kind}:${method.id}`)).toEqual([
      "password:password",
      "passkey:passkey",
      "oauth:github",
      "oauth:keycloak",
      "sso:okta",
    ]);
  });

  it("refuses a provider id used twice across social and oauth", () => {
    expect(() =>
      describeLoginMethods(
        options({
          social: [{ id: "github", label: "GitHub", clientId: "c" }],
          oauth: [{ ...OAUTH, id: "github" }],
        }),
      ),
    ).toThrow('Duplicate shelf login method id "github"');
  });
});

describe("buildSocialProviders", () => {
  it("is undefined without providers", () => {
    expect(buildSocialProviders(options())).toBeUndefined();
  });

  it("keys providers by id, omits an absent secret and skips undefined extras", () => {
    expect(
      buildSocialProviders(
        options({
          social: [
            { id: "github", label: "GitHub", clientId: "g", clientSecret: "s" },
            {
              id: "microsoft",
              label: "Microsoft",
              clientId: "e",
              extra: { tenantId: "t", skipped: undefined },
            },
          ],
        }),
      ),
    ).toEqual({
      github: { clientId: "g", clientSecret: "s" },
      microsoft: { clientId: "e", tenantId: "t" },
    });
  });
});

describe("buildPlugins", () => {
  it("is empty without oauth, passkeys, sso or extras", () => {
    expect(buildPlugins(options(), db)).toEqual([]);
  });

  it("adds a plugin for each of oauth, passkeys, sso and keeps the extras last", () => {
    const extra = { id: "extra" } as BetterAuthPlugin;
    const plugins = buildPlugins(
      options({
        oauth: [OAUTH],
        passkeys: {},
        sso: {
          providers: [
            {
              id: "okta",
              label: "Okta",
              domain: "example.com",
              oidc: { issuer: "i", clientId: "c" },
            },
          ],
        },
        plugins: [extra],
      }),
      db,
    );
    expect(plugins.map((plugin) => plugin.id)).toEqual([
      "generic-oauth",
      "passkey",
      "sso",
      "extra",
    ]);
  });
});

/** A custom plugin exposing one endpoint at `path`. */
function pluginAt(path: string): BetterAuthPlugin {
  return { id: "mine", endpoints: { one: { path } } } as unknown as BetterAuthPlugin;
}

describe("assertNoReservedEndpointCollision", () => {
  it("accepts no plugins and unrelated paths", () => {
    expect(() => assertNoReservedEndpointCollision([])).not.toThrow();
    expect(() => assertNoReservedEndpointCollision([pluginAt("/mine/ping")])).not.toThrow();
  });

  it.each(["/sign-in/email", "/sign-out", "/revoke-sessions", "/list-sessions"])(
    "refuses a plugin that shadows %s",
    (path) => {
      expect(() => assertNoReservedEndpointCollision([pluginAt(path)])).toThrow(
        `Shelf plugin "mine" shadows reserved engine path "${path}"`,
      );
    },
  );
});
