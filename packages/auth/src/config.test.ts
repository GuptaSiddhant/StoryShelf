import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnvRef, resolveAuthOptions } from "./config.ts";

const db = {} as DatabaseAdapter;

function base() {
  return {
    db,
    secret: "shh-that-is-long-enough-1234567890",
    baseURL: "http://localhost:3000",
  };
}

afterEach(() => {
  delete process.env["SHELF_TEST_A"];
  delete process.env["SHELF_TEST_B"];
  vi.unstubAllEnvs();
});

describe("parseEnvRef", () => {
  it("matches whole-string refs only", () => {
    expect(parseEnvRef("{env:SHELF_TEST_A}")).toBe("SHELF_TEST_A");
    expect(parseEnvRef("prefix-{env:SHELF_TEST_A}")).toBeNull();
    expect(parseEnvRef("{env:9bad}")).toBeNull();
    expect(parseEnvRef("plain")).toBeNull();
  });
});

describe("resolveAuthOptions", () => {
  it("passes literals through without touching the hook", async () => {
    const hook = vi.fn(async (_names: string[]) => ({}));
    const resolved = await resolveAuthOptions({ ...base(), resolveSecrets: hook });
    expect(resolved.secret).toBe("shh-that-is-long-enough-1234567890");
    expect(hook).not.toHaveBeenCalled();
  });

  it("resolves refs from process.env with literals winning", async () => {
    process.env["SHELF_TEST_A"] = "from-env-that-is-long-enough-123456";
    const resolved = await resolveAuthOptions({
      ...base(),
      secret: "{env:SHELF_TEST_A}",
      oauth: [
        {
          id: "keycloak",
          label: "Keycloak",
          clientId: "shelf",
          clientSecret: "literal-wins",
        },
      ],
    });
    expect(resolved.secret).toBe("from-env-that-is-long-enough-123456");
    expect(resolved.oauth?.[0]?.clientSecret).toBe("literal-wins");
  });

  it("falls back to resolveSecrets only for names missing from env", async () => {
    process.env["SHELF_TEST_A"] = "from-env-that-is-long-enough-123456";
    const hook = vi.fn(async (names: string[]) => ({
      SHELF_TEST_B: `hook-secret-1234567890:${names.join(",")}`,
    }));
    const resolved = await resolveAuthOptions({
      ...base(),
      secret: "{env:SHELF_TEST_A}",
      oauth: [
        {
          id: "keycloak",
          label: "Keycloak",
          clientId: "shelf",
          clientSecret: "{env:SHELF_TEST_B}",
        },
      ],
      resolveSecrets: hook,
    });
    expect(resolved.secret).toBe("from-env-that-is-long-enough-123456");
    expect(resolved.oauth?.[0]?.clientSecret).toBe("hook-secret-1234567890:SHELF_TEST_B");
    expect(hook).toHaveBeenCalledWith(["SHELF_TEST_B"]);
  });

  it("throws when a ref resolves nowhere", async () => {
    await expect(resolveAuthOptions({ ...base(), secret: "{env:SHELF_TEST_A}" })).rejects.toThrow(
      /SHELF_TEST_A/u,
    );
  });

  it("rejects structurally invalid options", async () => {
    await expect(resolveAuthOptions({ ...base(), baseURL: "not-a-url" })).rejects.toThrow(
      /Invalid shelf auth options/u,
    );
    await expect(resolveAuthOptions({ ...base(), secret: "" })).rejects.toThrow(
      /Invalid shelf auth options/u,
    );
  });

  it("rejects short secrets after resolution", async () => {
    await expect(resolveAuthOptions({ ...base(), secret: "too-short" })).rejects.toThrow(
      /at least 32 characters/u,
    );
    process.env["SHELF_TEST_A"] = "short";
    await expect(resolveAuthOptions({ ...base(), secret: "{env:SHELF_TEST_A}" })).rejects.toThrow(
      /at least 32 characters/u,
    );
  });

  it("leaves the live db adapter untouched while resolving refs", async () => {
    const live = createSqliteDatabase(":memory:");
    await live.lifecycle?.setup({ config: {}, logger: undefined as never });
    process.env["SHELF_TEST_A"] = "hook-secret-that-is-long-enough-123456";
    const resolved = await resolveAuthOptions({
      ...base(),
      db: live,
      secret: "{env:SHELF_TEST_A}",
      oauth: [{ id: "keycloak", label: "Keycloak", clientId: "shelf" }],
    });
    expect(resolved.secret).toBe("hook-secret-that-is-long-enough-123456");
    expect(resolved.db).toBe(live);
    // The adapter still works (prototype and tables intact, no clone damage).
    expect(await resolved.db.list(resolved.db.tables.users, { limit: 1 })).toEqual([]);
  });

  it("round-trips SSO group sync config", async () => {
    const resolved = await resolveAuthOptions({
      ...base(),
      sso: {
        providers: [
          {
            id: "acme",
            label: "Acme",
            domain: "example.com",
            oidc: { issuer: "https://idp.example.com", clientId: "shelf" },
            groups: { claim: ["groups", "cognito:groups"], admins: ["shelf-admins"] },
          },
        ],
      },
    });
    expect(resolved.sso?.providers[0]?.groups).toEqual({
      claim: ["groups", "cognito:groups"],
      admins: ["shelf-admins"],
    });
  });
});
