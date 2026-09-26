import { pino } from "pino";
import { describe, expect, it } from "vitest";
import type { AuthAdapter, AuthCallback, AuthUser } from "./auth.ts";
import type { AdapterSetupContext } from "./metadata.ts";
import { createMultiAuth } from "./multi-auth.ts";

const silentLogger = pino({ level: "silent" });
const setupCtx: AdapterSetupContext = { config: {}, logger: silentLogger };

const admin: AuthUser = { id: "user_1", email: "ada@example.com", name: "Ada", role: "admin" };

interface StubCounts {
  destroyed: number;
}

function stubSso(id: string, counts: StubCounts): AuthAdapter {
  return {
    metadata: { name: `SSO ${id}`, version: "0.0.0", kind: "oauth", category: "auth" },
    check: async (request: Request): Promise<AuthUser | null> => {
      await Promise.resolve();
      const cookie = request.headers.get("cookie") ?? "";
      return cookie.includes(`legacy=${id}`) ? admin : null;
    },
    createSession: async (): Promise<string> => {
      await Promise.resolve();
      return `member-${id}`;
    },
    destroySession: async (): Promise<void> => {
      await Promise.resolve();
      counts.destroyed += 1;
    },
    handleCallback: async (callback: AuthCallback): Promise<AuthUser | null> => {
      await Promise.resolve();
      return callback.code === "good" ? admin : null;
    },
  };
}

function stubPassword(): AuthAdapter & { login(password: string): Promise<string> } {
  return {
    metadata: { name: "Password", version: "0.0.0", kind: "password", category: "auth" },
    check: async (): Promise<AuthUser | null> => {
      await Promise.resolve();
      return null;
    },
    createSession: async (): Promise<string> => {
      await Promise.resolve();
      return "member-password";
    },
    destroySession: async (): Promise<void> => {
      await Promise.resolve();
    },
    login: async (password: string): Promise<string> => {
      await Promise.resolve();
      if (password !== "hunter2") {
        throw new Error("Invalid password");
      }
      return "member-password";
    },
  };
}

function authedRequest(token: string): Request {
  return new Request("https://example.com/", {
    headers: { cookie: `storyshelf_session=${token}` },
  });
}

describe("createMultiAuth", () => {
  it("rejects empty methods and duplicate or empty ids", () => {
    const counts: StubCounts = { destroyed: 0 };
    expect(() => createMultiAuth({ secret: "s", methods: [] })).toThrow(/at least one method/u);
    expect(() =>
      createMultiAuth({
        secret: "s",
        methods: [
          { id: "a", label: "A", adapter: stubSso("a", counts) },
          { id: "a", label: "A2", adapter: stubSso("a", counts) },
        ],
      }),
    ).toThrow(/unique/u);
    expect(() =>
      createMultiAuth({
        secret: "s",
        methods: [{ id: "", label: "B", adapter: stubSso("b", counts) }],
      }),
    ).toThrow(/non-empty/u);
  });

  it("round-trips a composite session with providerId", async () => {
    const counts: StubCounts = { destroyed: 0 };
    const auth = createMultiAuth({
      secret: "s",
      methods: [{ id: "sso", label: "SSO", adapter: stubSso("sso", counts) }],
    });
    const token = await auth.createSession({ ...admin, providerId: "sso" });
    const user = await auth.check(authedRequest(token));
    expect(user).toMatchObject({ id: admin.id, providerId: "sso" });
  });

  it("falls back to member checks for pre-upgrade cookies", async () => {
    const counts: StubCounts = { destroyed: 0 };
    const auth = createMultiAuth({
      secret: "s",
      methods: [{ id: "sso", label: "SSO", adapter: stubSso("sso", counts) }],
    });
    const request = new Request("https://example.com/", { headers: { cookie: "legacy=sso" } });
    const user = await auth.check(request);
    expect(user).toMatchObject({ id: admin.id, providerId: "sso" });
  });

  it("routes callbacks by providerId with single-member legacy fallback", async () => {
    const counts: StubCounts = { destroyed: 0 };
    const auth = createMultiAuth({
      secret: "s",
      methods: [
        { id: "pw", label: "Password", adapter: stubPassword() },
        { id: "sso", label: "SSO", adapter: stubSso("sso", counts) },
      ],
    });
    const routed = await auth.handleCallback?.({
      provider: "oidc",
      providerId: "sso",
      code: "good",
      state: "x",
    });
    expect(routed).toMatchObject({ id: admin.id, providerId: "sso" });
    expect(
      await auth.handleCallback?.({
        provider: "oidc",
        providerId: "nope",
        code: "good",
        state: "x",
      }),
    ).toBeNull();
    const single = createMultiAuth({
      secret: "s",
      methods: [{ id: "only", label: "Only", adapter: stubSso("only", counts) }],
    });
    const legacy = await single.handleCallback?.({ provider: "oidc", code: "good", state: "x" });
    expect(legacy).toMatchObject({ providerId: "only" });
  });

  it("fans destroySession out to every method and reports unhealthy members", async () => {
    const counts: StubCounts = { destroyed: 0 };
    const sick: AuthAdapter = {
      ...stubSso("sick", counts),
      lifecycle: {
        setup: async () => {},
        teardown: async () => {},
        health: async () => ({ ok: false, detail: "down" }),
      },
    };
    const auth = createMultiAuth({
      secret: "s",
      methods: [
        { id: "sso", label: "SSO", adapter: stubSso("sso", counts) },
        { id: "sick", label: "Sick", adapter: sick },
      ],
    });
    await auth.destroySession("any");
    expect(counts.destroyed).toBe(2);
    const emptySecret = createMultiAuth({
      secret: "",
      methods: [{ id: "sso", label: "SSO", adapter: stubSso("sso", counts) }],
    });
    await expect(emptySecret.lifecycle?.setup(setupCtx)).rejects.toThrow(/non-empty secret/u);
    const failing = createMultiAuth({
      secret: "s",
      methods: [{ id: "sick", label: "Sick", adapter: sick }],
    });
    await expect(failing.lifecycle?.health()).resolves.toMatchObject({ ok: false });
  });
});
