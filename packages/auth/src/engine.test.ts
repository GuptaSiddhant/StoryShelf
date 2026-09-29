import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { UserModel } from "@storyshelf/core/models";
import { ulid } from "@storyshelf/core/utils";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { baseAuthTables } from "./auth-tables.ts";
import { ENGINE_PROVIDER_ID, createShelfAuth, type ShelfAuth } from "./engine.ts";
import { githubPreset } from "./presets/index.ts";
import { samlPreset } from "./presets/sso.ts";

const AUTH_DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, ip_address TEXT, user_agent TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE account (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at TEXT, refresh_token_expires_at TEXT, scope TEXT, expires_at TEXT, password TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`;

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const FAKE_ISSUER = "https://idp.example.com";

async function testEngine(
  oauth = false,
  social = false,
  passkeys = false,
  sso = false,
): Promise<{ db: DatabaseAdapter; shelf: ShelfAuth }> {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-auth-engine-"));
  dirs.push(dir);
  const seed = new DatabaseSync(join(dir, "test.db"));
  seed.exec(AUTH_DDL);
  seed.close();
  const db = createSqliteDatabase(join(dir, "test.db"));
  await db.lifecycle?.setup({ config: {}, logger: undefined as never });
  const shelf = createShelfAuth({
    db,
    secret: "spike-secret-that-is-long-enough-123456",
    baseURL: "http://localhost:3000",
    ...(social ? { social: [githubPreset({ clientId: "shelf", clientSecret: "shh" })] } : {}),
    ...(passkeys ? { passkeys: {} } : {}),
    ...(sso
      ? {
          sso: {
            providers: [
              samlPreset({
                id: "acme-saml",
                label: "Acme",
                domain: "example.com",
                issuer: "http://localhost:3000",
                entryPoint: "https://idp.example.com/sso",
                cert: "FAKE-CERT",
                entityID: "https://idp.example.com/metadata",
              }),
            ],
          },
        }
      : {}),
    ...(oauth
      ? {
          oauth: [
            {
              id: "keycloak",
              label: "Keycloak",
              clientId: "storyshelf",
              clientSecret: "shh",
              authorizationUrl: `${FAKE_ISSUER}/protocol/openid-connect/auth`,
              tokenUrl: `${FAKE_ISSUER}/protocol/openid-connect/token`,
              userInfoUrl: `${FAKE_ISSUER}/protocol/openid-connect/userinfo`,
              scopes: ["openid", "email", "profile"],
            },
          ],
        }
      : {}),
  });
  return { db, shelf };
}

const json = { "content-type": "application/json", origin: "http://localhost:3000" };

async function post(
  shelf: ShelfAuth,
  path: string,
  body: unknown,
  cookie?: string,
): Promise<Response> {
  return await shelf.auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { ...json, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

function sessionCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}

async function get(shelf: ShelfAuth, path: string, cookie?: string): Promise<Response> {
  return await shelf.auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      headers: { origin: "http://localhost:3000", ...(cookie ? { cookie } : {}) },
    }),
  );
}

function requestWithCookie(cookie: string): Request {
  return new Request("http://localhost:3000/", { headers: { cookie } });
}

async function passwordCookie(shelf: ShelfAuth, email: string, password: string): Promise<string> {
  const signin = await post(shelf, "/sign-in/email", { email, password });
  if (signin.status !== 200) {
    throw new Error(`signin ${signin.status}: ${await signin.text()}`);
  }
  return sessionCookie(signin);
}

/** Onboard a local user the supported way (public signup is disabled). */
async function inviteUser(shelf: ShelfAuth, email: string, name: string): Promise<void> {
  const issued = await shelf.adapter.issueInvite({ email, name, role: "member" });
  await shelf.adapter.acceptInvite({
    inviteId: issued.inviteId,
    token: issued.token,
    password: "hunter2hunter2",
  });
}

async function awaitMirror(db: DatabaseAdapter, id: string): Promise<void> {
  // Polling inherently awaits in sequence.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- poll loop must be sequential
    const row = await new UserModel(db).get(id);
    if (row) {
      return;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- poll loop must be sequential
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`mirror row missing for ${id}`);
}

describe("createShelfAuth", () => {
  it("rejects public signup and onboards invitees with ULID ids", async () => {
    const { db, shelf } = await testEngine();
    const signup = await post(shelf, "/sign-up/email", {
      email: "mallory@example.com",
      password: "hunter2hunter2",
      name: "Mallory",
    });
    expect(signup.status).toBe(400);

    await inviteUser(shelf, "ada@example.com", "Ada");
    const signin = await post(shelf, "/sign-in/email", {
      email: "ada@example.com",
      password: "hunter2hunter2",
    });
    const cookie = sessionCookie(signin);
    const user = await shelf.adapter.check(
      new Request("http://localhost:3000/", { headers: { cookie } }),
    );
    expect(user?.id).toHaveLength(26);
    await awaitMirror(db, user?.id ?? "");
    const stored = await new UserModel(db).get(user?.id ?? "");
    expect(stored?.email).toBe("ada@example.com");
    expect(stored?.role).toBe("member");
  });

  it("resolves sessions to users and revokes on sign-out", async () => {
    const { shelf } = await testEngine();
    await inviteUser(shelf, "bob@example.com", "Bob");
    const signin = await post(shelf, "/sign-in/email", {
      email: "bob@example.com",
      password: "hunter2hunter2",
    });
    if (signin.status !== 200) {
      throw new Error(`signin ${signin.status}: ${await signin.text()}`);
    }
    const cookie = sessionCookie(signin);
    expect(cookie).toContain("storyshelf_session=");

    const user = await shelf.adapter.check(
      new Request("http://localhost:3000/", { headers: { cookie } }),
    );
    expect(user?.email).toBe("bob@example.com");
    expect(user?.providerId).toBe(ENGINE_PROVIDER_ID);

    const token = cookie.slice("storyshelf_session=".length);
    await shelf.adapter.destroySession(token);
    const gone = await shelf.adapter.check(
      new Request("http://localhost:3000/", { headers: { cookie } }),
    );
    expect(gone).toBeNull();
  });

  it("destroys sessions by raw table token", async () => {
    const { shelf } = await testEngine();
    await inviteUser(shelf, "beth@example.com", "Beth");
    const cookie = await passwordCookie(shelf, "beth@example.com", "hunter2hunter2");
    const user = await shelf.adapter.check(
      new Request("http://localhost:3000/", { headers: { cookie } }),
    );
    const sessions = await shelf.adapter.listSessions(user?.id ?? "");
    expect(sessions).toHaveLength(1);
    await shelf.adapter.destroySession(sessions[0]?.token ?? "");
    await expect(shelf.adapter.listSessions(user?.id ?? "")).resolves.toEqual([]);
    const gone = await shelf.adapter.check(
      new Request("http://localhost:3000/", { headers: { cookie } }),
    );
    expect(gone).toBeNull();
  });

  it("refuses standalone session minting and empty destroys", async () => {
    const { shelf } = await testEngine();
    await expect(shelf.adapter.createSession({} as never)).rejects.toThrow(/engine endpoints/u);
    await shelf.adapter.destroySession("");
  });

  it("rejects short secrets at setup", async () => {
    const { db } = await testEngine();
    const weak = createShelfAuth({
      db,
      secret: "too-short",
      baseURL: "http://localhost:3000",
    });
    await expect(weak.adapter.setup()).rejects.toThrow(/at least 32 characters/u);
  });

  it("describes password and oauth methods and builds the Keycloak redirect offline", async () => {
    const { shelf } = await testEngine(true);
    expect(shelf.adapter.loginMethods()).toEqual([
      { kind: "password", id: "password", label: "Email" },
      { kind: "oauth", id: "keycloak", label: "Keycloak" },
    ]);
    const started = await post(shelf, "/sign-in/social", {
      provider: "keycloak",
      callbackURL: "/",
      disableRedirect: true,
    });
    expect(started.status).toBe(200);
    const body = (await started.json()) as { url?: string };
    expect(body.url ?? "").toContain(FAKE_ISSUER);
  });

  it("describes social methods and builds the GitHub redirect offline", async () => {
    const { shelf } = await testEngine(false, true);
    expect(shelf.adapter.loginMethods()).toEqual([
      { kind: "password", id: "password", label: "Email" },
      { kind: "oauth", id: "github", label: "GitHub" },
    ]);
    const started = await post(shelf, "/sign-in/social", {
      provider: "github",
      callbackURL: "/",
      disableRedirect: true,
    });
    expect(started.status).toBe(200);
    const body = (await started.json()) as { url?: string };
    expect(body.url ?? "").toContain("github.com");
  });

  it("resolves users without a composite wrapper", async () => {
    const { shelf } = await testEngine();
    await inviteUser(shelf, "cara@example.com", "Cara");
    const signin = await post(shelf, "/sign-in/email", {
      email: "cara@example.com",
      password: "hunter2hunter2",
    });
    const cookie = sessionCookie(signin);
    const user = await shelf.adapter.check(
      new Request("http://localhost:3000/", { headers: { cookie } }),
    );
    expect(user?.email).toBe("cara@example.com");
    expect(user?.providerId).toBe(ENGINE_PROVIDER_ID);
  });

  it("describes the SSO method and serves SAML metadata offline", async () => {
    const { shelf } = await testEngine(false, false, false, true);
    expect(shelf.adapter.loginMethods()).toContainEqual({
      kind: "sso",
      id: "acme-saml",
      label: "Acme",
    });
    const meta = await get(shelf, "/sso/saml2/sp/metadata?providerId=acme-saml");
    expect(meta.status).toBe(200);
    expect(meta.headers.get("content-type")).toContain("application/xml");
    const xml = await meta.text();
    expect(xml).toContain('entityID="http://localhost:3000"');

    const missing = await get(shelf, "/sso/saml2/sp/metadata?providerId=nope");
    expect(missing.status).toBe(404);
  });

  it("starts the SAML flow offline and rejects unknown providers", async () => {
    const { shelf } = await testEngine(false, false, false, true);
    const started = await post(shelf, "/sign-in/sso", {
      providerId: "acme-saml",
      callbackURL: "/",
    });
    expect(started.status).toBe(200);
    const body = (await started.json()) as { url?: string };
    expect(body.url ?? "").toContain("https://idp.example.com/sso?SAMLRequest=");

    const unknown = await post(shelf, "/sign-in/sso", { providerId: "nope", callbackURL: "/" });
    expect(unknown.status).not.toBe(200);
  });

  it("serves SAML metadata with group sync configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-auth-groups-"));
    dirs.push(dir);
    const seed = new DatabaseSync(join(dir, "test.db"));
    seed.exec(AUTH_DDL);
    seed.close();
    const db = createSqliteDatabase(join(dir, "test.db"));
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    const shelf = createShelfAuth({
      db,
      secret: "spike-secret-that-is-long-enough-123456",
      baseURL: "http://localhost:3000",
      sso: {
        providers: [
          samlPreset({
            id: "acme-groups",
            label: "Acme Groups",
            domain: "example.com",
            issuer: "http://localhost:3000",
            entryPoint: "https://idp.example.com/sso",
            entityID: "https://idp.example.com/metadata",
            groupsAttribute: "http://schemas.example.com/groups",
            adminGroups: ["Acme Admins"],
          }),
        ],
      },
    });
    expect(shelf.adapter.loginMethods()).toContainEqual({
      kind: "sso",
      id: "acme-groups",
      label: "Acme Groups",
    });
    const meta = await get(shelf, "/sso/saml2/sp/metadata?providerId=acme-groups");
    expect(meta.status).toBe(200);
    const started = await post(shelf, "/sign-in/sso", {
      providerId: "acme-groups",
      callbackURL: "/",
    });
    expect(started.status).toBe(200);
    const body = (await started.json()) as { url?: string };
    expect(body.url ?? "").toContain("https://idp.example.com/sso?SAMLRequest=");
  });

  it("blocks runtime SSO provider management", async () => {
    const { shelf } = await testEngine(false, false, false, true);
    await inviteUser(shelf, "mallory@example.com", "Mallory");
    const cookie = await passwordCookie(shelf, "mallory@example.com", "hunter2hunter2");
    const register = await post(
      shelf,
      "/sso/register",
      { issuer: "https://evil.example.com", providerId: "evil", domain: "evil.example" },
      cookie,
    );
    expect(register.status).toBe(404);
    const providers = await get(shelf, "/sso/providers", cookie);
    expect(providers.status).toBe(404);
  });

  it("lists sessions and changes passwords through the engine", async () => {
    const { shelf } = await testEngine();
    await inviteUser(shelf, "dana@example.com", "Dana");
    const cookie = await passwordCookie(shelf, "dana@example.com", "hunter2hunter2");

    const listed = await get(shelf, "/list-sessions", cookie);
    expect(listed.status).toBe(200);
    const sessions = (await listed.json()) as Array<{ userId: string }>;
    expect(sessions).toHaveLength(1);

    const changed = await post(
      shelf,
      "/change-password",
      { currentPassword: "hunter2hunter2", newPassword: "rotated-pass-34" },
      cookie,
    );
    expect(changed.status).toBe(200);

    const rotated = await post(shelf, "/sign-in/email", {
      email: "dana@example.com",
      password: "rotated-pass-34",
    });
    expect(rotated.status).toBe(200);
    const stale = await post(shelf, "/sign-in/email", {
      email: "dana@example.com",
      password: "hunter2hunter2",
    });
    expect(stale.status).not.toBe(200);
  });

  it("revokes other sessions but keeps the caller", async () => {
    const { shelf } = await testEngine();
    await inviteUser(shelf, "erin@example.com", "Erin");
    const first = await passwordCookie(shelf, "erin@example.com", "hunter2hunter2");
    const second = await passwordCookie(shelf, "erin@example.com", "hunter2hunter2");

    const revoked = await post(shelf, "/revoke-other-sessions", {}, first);
    expect(revoked.status).toBe(200);

    await expect(shelf.adapter.check(requestWithCookie(first))).resolves.not.toBeNull();
    await expect(shelf.adapter.check(requestWithCookie(second))).resolves.toBeNull();
  });

  it("exposes adapter inventory for the profile page", async () => {
    const { shelf } = await testEngine();
    expect(shelf.adapter.passkeysEnabled()).toBe(false);
    await inviteUser(shelf, "fred@example.com", "Fred");
    const cookie = await passwordCookie(shelf, "fred@example.com", "hunter2hunter2");
    const user = await shelf.adapter.check(
      new Request("http://localhost:3000/", { headers: { cookie } }),
    );
    const userId = user?.id ?? "";
    await expect(shelf.adapter.hasPassword(userId)).resolves.toBe(true);
    const sessions = await shelf.adapter.listSessions(userId);
    expect(sessions).toHaveLength(1);
    expect(sessions.some((session) => cookie.includes(session.token))).toBe(true);
    await expect(shelf.adapter.listPasskeys(userId)).resolves.toEqual([]);
  });

  it("registers passkey options and deletes keys through the plugin", async () => {
    const { db, shelf } = await testEngine(false, false, true);
    expect(shelf.adapter.passkeysEnabled()).toBe(true);
    expect(shelf.adapter.loginMethods()).toContainEqual({
      kind: "passkey",
      id: "passkey",
      label: "Passkey",
    });
    await inviteUser(shelf, "gina@example.com", "Gina");
    const cookie = await passwordCookie(shelf, "gina@example.com", "hunter2hunter2");
    const user = await shelf.adapter.check(
      new Request("http://localhost:3000/", { headers: { cookie } }),
    );
    const userId = user?.id ?? "";

    const options = await get(shelf, "/passkey/generate-register-options", cookie);
    expect(options.status).toBe(200);
    const challenge = (await options.json()) as { challenge?: string };
    expect(challenge.challenge).toBeTruthy();

    const keyId = ulid();
    const now = new Date().toISOString();
    await db.insert(baseAuthTables.passkey, {
      id: keyId,
      name: "Laptop",
      publicKey: "cGsta2V5",
      userId,
      credentialID: `cred-${keyId}`,
      counter: 0,
      deviceType: "platform",
      backedUp: false,
      transports: null,
      aaguid: null,
      createdAt: now,
      updatedAt: now,
    });
    await expect(shelf.adapter.listPasskeys(userId)).resolves.toHaveLength(1);

    const deleted = await post(shelf, "/passkey/delete-passkey", { id: keyId }, cookie);
    expect(deleted.status).toBe(200);
    await expect(shelf.adapter.listPasskeys(userId)).resolves.toEqual([]);
  });

  it("rejects disabled users and revokes their sessions on disable", async () => {
    const { shelf } = await testEngine();
    await inviteUser(shelf, "zed@example.com", "Zed");
    const cookie = await passwordCookie(shelf, "zed@example.com", "hunter2hunter2");
    const request = new Request("http://localhost:3000/", { headers: { cookie } });
    await expect(shelf.adapter.check(request)).resolves.not.toBeNull();

    const user = await shelf.adapter.check(request);
    await shelf.adapter.setDisabled(user?.id ?? "", true);
    await expect(shelf.adapter.check(request)).resolves.toBeNull();
    await expect(shelf.adapter.listSessions(user?.id ?? "")).resolves.toEqual([]);

    await shelf.adapter.setDisabled(user?.id ?? "", false);
    const fresh = await passwordCookie(shelf, "zed@example.com", "hunter2hunter2");
    await expect(
      shelf.adapter.check(new Request("http://localhost:3000/", { headers: { cookie: fresh } })),
    ).resolves.not.toBeNull();
  });

  it("refreshes IdP profile drift without clobbering the display override", async () => {
    const { db, shelf } = await testEngine();
    await inviteUser(shelf, "drift@example.com", "Drift");
    const cookie = await passwordCookie(shelf, "drift@example.com", "hunter2hunter2");
    const request = new Request("http://localhost:3000/", { headers: { cookie } });
    const user = await shelf.adapter.check(request);
    const userId = user?.id ?? "";
    await new UserModel(db).setDisplayNameOverride(userId, "My Name");
    // Simulate an IdP profile change behind the session's back.
    await db.update(db.tables.users, userId, { name: "Stale", avatarUrl: null });
    const refreshed = await shelf.adapter.check(request);
    expect(refreshed?.name).toBe("My Name");
    const stored = await new UserModel(db).get(userId);
    expect(stored?.name).toBe("Drift");
    expect(stored?.displayNameOverride).toBe("My Name");
  });

  it("rejects duplicate login method ids and shadowing plugins at boot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-auth-contract-"));
    dirs.push(dir);
    const seed = new DatabaseSync(join(dir, "test.db"));
    seed.exec(AUTH_DDL);
    seed.close();
    const db = createSqliteDatabase(join(dir, "test.db"));
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    const options = {
      db,
      secret: "spike-secret-that-is-long-enough-123456",
      baseURL: "http://localhost:3000",
    } as const;
    expect(() =>
      createShelfAuth({
        ...options,
        social: [githubPreset({ clientId: "shelf" })],
        oauth: [{ id: "github", label: "Other", clientId: "shelf" }],
      }),
    ).toThrow(/Duplicate shelf login method id "github"/u);
    expect(() =>
      createShelfAuth({
        ...options,
        plugins: [
          {
            id: "evil",
            endpoints: { hijack: { path: "/sign-in/email", options: { method: "POST" } } },
          } as never,
        ],
      }),
    ).toThrow(/shadows reserved engine path "\/sign-in\/email"/u);
  });
});
