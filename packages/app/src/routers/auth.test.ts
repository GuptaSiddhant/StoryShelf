import { createShelfAuth, samlPreset, type ShelfAuth } from "@storyshelf/auth";
import { baseAuthTables } from "@storyshelf/auth";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { makeStorage } from "@storyshelf/core/test-helpers";
import { ulid } from "@storyshelf/core/utils";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";

const silentLogger = pino({ level: "silent" });
const SECRET = "test-secret";
const FAKE_ISSUER = "https://idp.example.com";
const BASE_URL = "http://localhost:3000";
const JSON_HEADERS = { "content-type": "application/json", origin: BASE_URL };

async function testEngine(): Promise<{ db: DatabaseAdapter; shelf: ShelfAuth }> {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: silentLogger });
  const shelf = createShelfAuth({
    db,
    secret: "spike-secret-that-is-long-enough-123456",
    baseURL: BASE_URL,
    passkeys: {},
    sso: {
      providers: [
        samlPreset({
          id: "acme-saml",
          label: "Acme",
          domain: "example.com",
          issuer: BASE_URL,
          entryPoint: "https://idp.example.com/sso",
          cert: "FAKE-CERT",
          entityID: "https://idp.example.com/metadata",
        }),
      ],
    },
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
  });
  return { db, shelf };
}

function testApp(db: DatabaseAdapter, shelf: ShelfAuth): ReturnType<typeof createShelfApp> {
  const { storage } = makeStorage();
  return createShelfApp({
    database: db,
    storage,
    auth: shelf.adapter,
    logger: silentLogger,
    config: { secret: SECRET },
  });
}

async function signup(shelf: ShelfAuth, email: string): Promise<void> {
  const issued = await shelf.adapter.issueInvite({ email, name: "Ada", role: "member" });
  await shelf.adapter.acceptInvite({
    inviteId: issued.inviteId,
    token: issued.token,
    password: "hunter2hunter2",
  });
}

function sessionOf(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}

/** The toast message queued by the response's flash cookie, if any. */
function flashOf(response: Response): string | undefined {
  const raw = /storyshelf_flash=([^;]+)/u.exec(response.headers.get("set-cookie") ?? "")?.[1];
  return raw ? (JSON.parse(decodeURIComponent(raw)) as { message: string }).message : undefined;
}

describe("engine auth routes", () => {
  it("renders the descriptor-driven login page", async () => {
    const { db, shelf } = await testEngine();
    const response = await testApp(db, shelf).request("/auth/login");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Keycloak");
    expect(html).toContain('name="email"');
    expect(html).toContain("/auth/engine/login");
    expect(html).toContain("Sign in with a passkey");
    expect(html).toContain("data-passkey-login");
    expect(html).toContain("Acme");
    expect(html).toContain("/auth/engine/acme-saml");
  });

  it("renders sign-in without the app sidebar or admin links", async () => {
    const { db, shelf } = await testEngine();
    const html = await (await testApp(db, shelf).request("/auth/login")).text();
    expect(html).toContain("bare__brand");
    expect(html).not.toContain('aria-label="Primary"');
    expect(html).not.toContain("/admin");
  });

  it("signs in with email and password through the engine", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "ada@example.com");

    const form = new FormData();
    form.set("email", "ada@example.com");
    form.set("password", "hunter2hunter2");
    const response = await app.request("/auth/engine/login", {
      method: "POST",
      headers: { origin: BASE_URL },
      body: form,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(sessionOf(response)).toContain("storyshelf_session=");
  });

  it("rejects wrong credentials with the login page", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "ada@example.com");

    const form = new FormData();
    form.set("email", "ada@example.com");
    form.set("password", "wrongpassword12");
    const response = await app.request("/auth/engine/login", {
      method: "POST",
      headers: { origin: BASE_URL },
      body: form,
    });
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("Invalid credentials");
  });

  it("starts the Keycloak flow offline and rejects unknown providers", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);

    const started = await app.request("/auth/engine/keycloak", { headers: { origin: BASE_URL } });
    expect(started.status).toBe(302);
    expect(started.headers.get("location") ?? "").toContain(FAKE_ISSUER);
    expect(started.headers.get("set-cookie") ?? "").not.toBe("");

    const unknown = await app.request("/auth/engine/nope");
    expect(unknown.status).toBe(404);
  });

  it("starts the SAML flow offline and rejects unknown providers", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);

    const started = await app.request("/auth/engine/acme-saml", {
      headers: { origin: BASE_URL },
    });
    expect(started.status).toBe(302);
    expect(started.headers.get("location") ?? "").toContain(
      "https://idp.example.com/sso?SAMLRequest=",
    );

    const unknown = await app.request("/auth/engine/nope");
    expect(unknown.status).toBe(404);
  });

  it("serves the mounted engine endpoints directly", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "ada@example.com");

    const response = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: "ada@example.com", password: "hunter2hunter2" }),
    });
    expect(response.status).toBe(200);
    expect(sessionOf(response)).toContain("storyshelf_session=");
  });

  it("revokes the session on logout", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "ada@example.com");

    const form = new FormData();
    form.set("email", "ada@example.com");
    form.set("password", "hunter2hunter2");
    const login = await app.request("/auth/engine/login", {
      method: "POST",
      headers: { origin: BASE_URL },
      body: form,
    });
    const cookie = sessionOf(login);

    const logout = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        cookie,
        origin: BASE_URL,
        "x-csrf-token": getCsrfToken(SECRET, sessionIdOf(cookie)),
      },
    });
    expect(logout.status).not.toBe(500);

    const profile = await app.request("/profile", { headers: { cookie } });
    expect(profile.status).toBe(302);
    expect(profile.headers.get("location")).toBe("/auth/login");
  });

  it("marks the logout clear-cookie Secure over HTTPS", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "ada@example.com");
    const cookie = await loginCookie(app, "ada@example.com", "hunter2hunter2");

    const plain = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        cookie,
        origin: BASE_URL,
        "x-csrf-token": getCsrfToken(SECRET, sessionIdOf(cookie)),
      },
    });
    expect(plain.headers.get("set-cookie") ?? "").not.toContain("Secure");

    const tls = await app.request("https://localhost:3000/auth/logout", {
      method: "POST",
      headers: {
        cookie,
        origin: BASE_URL,
        "x-csrf-token": getCsrfToken(SECRET, sessionIdOf(cookie)),
      },
    });
    expect(tls.headers.get("set-cookie") ?? "").toContain("Secure");
  });

  it("rejects logout and invite accepts without a CSRF token", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "ada@example.com");
    const cookie = await loginCookie(app, "ada@example.com", "hunter2hunter2");

    const logout = await app.request("/auth/logout", {
      method: "POST",
      headers: { cookie, origin: BASE_URL },
    });
    expect(logout.status).toBe(403);

    const issued = await shelf.adapter.issueInvite({
      email: "x@example.com",
      name: "X",
      role: "member",
    });
    const form = new FormData();
    form.set("token", issued.token);
    form.set("password", "correct-horse-12");
    form.set("confirm", "correct-horse-12");
    const accept = await app.request(`/auth/invites/${issued.inviteId}`, {
      method: "POST",
      headers: { origin: BASE_URL },
      body: form,
    });
    expect(accept.status).toBe(403);
  });

  it("accepts an invite and signs in with the new password", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    const issued = await shelf.adapter.issueInvite({
      email: "lead@example.com",
      name: "Lead",
      role: "admin",
    });

    const page = await app.request(`/auth/invites/${issued.inviteId}?token=${issued.token}`);
    expect(page.status).toBe(200);
    const inviteHtml = await page.text();
    expect(inviteHtml).toContain("lead@example.com");
    expect(inviteHtml).toContain("bare__brand");

    const form = new FormData();
    form.set("token", issued.token);
    form.set("password", "correct-horse-12");
    form.set("confirm", "correct-horse-12");
    form.set("csrf_token", getCsrfToken(SECRET));
    const accepted = await app.request(`/auth/invites/${issued.inviteId}`, {
      method: "POST",
      headers: { origin: BASE_URL },
      body: form,
    });
    expect(accepted.status).toBe(302);
    expect(accepted.headers.get("location")).toBe("/profile");
    const cookie = sessionOf(accepted);
    expect(cookie).toContain("storyshelf_session=");

    const profile = await app.request("/profile", { headers: { cookie } });
    expect(profile.status).toBe(200);
  });

  it("rate-limits credential floods", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    let last = 0;
    // Dedicated forwarding key: the flood must not eat other tests' budget.
    const headers = { origin: BASE_URL, "x-forwarded-for": "flood-test" };
    // Sequential: the limiter counts per key in one shared store.
    for (let attempt = 0; attempt < 101; attempt += 1) {
      const form = new FormData();
      form.set("email", "nobody@example.com");
      form.set("password", "wrongpassword12");
      // oxlint-disable-next-line eslint/no-await-in-loop -- flood must be sequential to count
      const response = await app.request("/auth/engine/login", {
        method: "POST",
        headers,
        body: form,
      });
      last = response.status;
    }
    expect(last).toBe(429);
  }, 30_000);

  it("rejects mismatched passwords and spent invites", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    const issued = await shelf.adapter.issueInvite({
      email: "fin@example.com",
      name: "Fin",
      role: "member",
    });

    const mismatch = new FormData();
    mismatch.set("token", issued.token);
    mismatch.set("password", "correct-horse-12");
    mismatch.set("confirm", "other-horse-34");
    mismatch.set("csrf_token", getCsrfToken(SECRET));
    const rejected = await app.request(`/auth/invites/${issued.inviteId}`, {
      method: "POST",
      headers: { origin: BASE_URL },
      body: mismatch,
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).toContain("Passwords do not match");

    const spent = await app.request(`/auth/invites/nope?token=${issued.token}`);
    expect(spent.status).toBe(400);
  });
});

async function loginCookie(
  app: ReturnType<typeof createShelfApp>,
  email: string,
  password: string,
): Promise<string> {
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  const response = await app.request("/auth/engine/login", {
    method: "POST",
    headers: { origin: BASE_URL },
    body: form,
  });
  expect(response.status).toBe(302);
  return sessionOf(response);
}

function profileForm(
  app: ReturnType<typeof createShelfApp>,
  path: string,
  cookie: string,
  form: FormData,
): Response | Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: {
      cookie,
      origin: BASE_URL,
      "x-csrf-token": getCsrfToken(SECRET, sessionIdOf(cookie)),
    },
    body: form,
  });
}

/** Session id the CSRF middleware binds (raw session cookie value). */
function sessionIdOf(cookie: string): string {
  for (const part of cookie.split(";")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex !== -1 && part.slice(0, eqIndex).trim() === "storyshelf_session") {
      return part.slice(eqIndex + 1).trim();
    }
  }
  return "default";
}

async function seedPasskey(db: DatabaseAdapter, userId: string, name: string): Promise<string> {
  const id = ulid();
  const now = new Date().toISOString();
  await db.insert(baseAuthTables.passkey, {
    id,
    name,
    publicKey: "cGsta2V5",
    userId,
    credentialID: `cred-${id}`,
    counter: 0,
    deviceType: "platform",
    backedUp: false,
    transports: null,
    aaguid: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("engine profile page", () => {
  it("shows devices, passkeys, and the backup nudge", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "ada@example.com");
    const cookie = await loginCookie(app, "ada@example.com", "hunter2hunter2");

    const response = await app.request("/profile", { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("Devices");
    expect(html).toContain("This device");
    expect(html).toContain("Passkeys");
    expect(html).toContain("2nd key");
    expect(html).toContain("Change password");
  });

  it("changes the password through the engine", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "bob@example.com");
    const cookie = await loginCookie(app, "bob@example.com", "hunter2hunter2");

    const form = new FormData();
    form.set("currentPassword", "hunter2hunter2");
    form.set("newPassword", "rotated-pass-34");
    form.set("confirmPassword", "rotated-pass-34");
    const changed = await profileForm(app, "/profile/password", cookie, form);
    expect(changed.status).toBe(200);
    expect(flashOf(changed)).toBe("Password changed");

    await loginCookie(app, "bob@example.com", "rotated-pass-34");
  });

  it("rejects a wrong current password", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "cara@example.com");
    const cookie = await loginCookie(app, "cara@example.com", "hunter2hunter2");

    const form = new FormData();
    form.set("currentPassword", "wrongpassword12");
    form.set("newPassword", "rotated-pass-34");
    form.set("confirmPassword", "rotated-pass-34");
    const rejected = await profileForm(app, "/profile/password", cookie, form);
    expect(rejected.status).toBe(400);
  });

  it("signs out other devices but keeps the caller", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "dana@example.com");
    const first = await loginCookie(app, "dana@example.com", "hunter2hunter2");
    const second = await loginCookie(app, "dana@example.com", "hunter2hunter2");

    const revoked = await profileForm(
      app,
      "/profile/sessions/revoke-others",
      first,
      new FormData(),
    );
    expect(revoked.status).toBe(200);
    expect(flashOf(revoked)).toContain("other devices");

    const alive = await app.request("/profile", { headers: { cookie: first } });
    expect(alive.status).toBe(200);
    const dead = await app.request("/profile", { headers: { cookie: second } });
    expect(dead.status).toBe(302);
  });

  it("revokes one device by session id and rejects forged ids", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "gus@example.com");
    const first = await loginCookie(app, "gus@example.com", "hunter2hunter2");
    const second = await loginCookie(app, "gus@example.com", "hunter2hunter2");
    const me = await shelf.adapter.check(new Request(BASE_URL, { headers: { cookie: first } }));
    const target = (await shelf.adapter.listSessions(me?.id ?? "")).find((session) =>
      second.includes(session.token),
    );

    const form = new FormData();
    form.set("sessionId", target?.id ?? "");
    const revoked = await profileForm(app, "/profile/sessions/revoke", first, form);
    expect(revoked.status).toBe(200);
    expect(flashOf(revoked)).toBe("Session revoked");

    const dead = await app.request("/profile", { headers: { cookie: second } });
    expect(dead.status).toBe(302);
    const alive = await app.request("/profile", { headers: { cookie: first } });
    expect(alive.status).toBe(200);

    const forged = new FormData();
    forged.set("sessionId", "no-such-session");
    const rejected = await profileForm(app, "/profile/sessions/revoke", first, forged);
    expect(rejected.status).toBe(400);
  });

  it("removes a passkey and restores the nudge", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "erin@example.com");
    const cookie = await loginCookie(app, "erin@example.com", "hunter2hunter2");
    const user = await shelf.adapter.check(new Request(BASE_URL, { headers: { cookie } }));
    const keyId = await seedPasskey(db, user?.id ?? "", "Laptop");

    const before = await app.request("/profile", { headers: { cookie } });
    expect(await before.text()).toContain(">Laptop<");

    const removed = await profileForm(
      app,
      `/profile/passkeys/${keyId}/delete`,
      cookie,
      new FormData(),
    );
    expect(removed.status).toBe(200);
    const after = await app.request("/profile", { headers: { cookie } });
    const html = await after.text();
    expect(html).not.toContain(">Laptop<");
    expect(html).toContain("2nd key");
  });
});
