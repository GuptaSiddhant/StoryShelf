import { createShelfAuth, samlPreset, type ShelfAuth } from "@storyshelf/auth";
import { baseAuthTables } from "@storyshelf/auth";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { BuildModel, MemberModel } from "@storyshelf/core/models";
import { makeStorage } from "@storyshelf/core/test-helpers";
import { ulid } from "@storyshelf/core/utils";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";

const silentLogger = pino({ level: "silent" });

// A spy made with `vi.spyOn` must not outlive its test, whether or not the test got to the end.
afterEach(() => {
  vi.restoreAllMocks();
});
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
          cert: "RkFLRUNFUlQ=",
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

  it("reports an unusable email address instead of invalid credentials", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);

    const form = new FormData();
    form.set("email", "admin@local");
    form.set("password", "whatever-password-12");
    const response = await app.request("/auth/engine/login", {
      method: "POST",
      headers: { origin: BASE_URL },
      body: form,
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Enter a valid email address");
  });

  it("redirects a GET of the login action back to the login page", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);

    const response = await app.request("/auth/engine/login");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/login");
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
    expect(profile.headers.get("location")).toBe("/auth/login?return_to=%2Fprofile");
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
  }, 120_000);

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

  it("shows the password policy and an invalid invite, but never an internal failure's text", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    const issued = await shelf.adapter.issueInvite({
      email: "gus@example.com",
      name: "Gus",
      role: "member",
    });
    const accept = async (inviteId: string, token: string, password: string) => {
      const body = new FormData();
      body.set("token", token);
      body.set("password", password);
      body.set("confirm", password);
      body.set("csrf_token", getCsrfToken(SECRET));
      return await app.request(`/auth/invites/${inviteId}`, {
        method: "POST",
        headers: { origin: BASE_URL },
        body,
      });
    };

    const short = await accept(issued.inviteId, issued.token, "short");
    expect(short.status).toBe(400);
    const shortHtml = await short.text();
    expect(shortHtml).toContain("Password must be at least 12 characters");

    const wrongToken = await accept(issued.inviteId, "not-the-token", "correct-horse-12");
    expect(wrongToken.status).toBe(400);
    expect(await wrongToken.text()).toContain("Invalid or expired invite");

    vi.spyOn(shelf.adapter, "acceptInvite").mockRejectedValue(
      new Error("SQLITE_BUSY: database is locked (/var/data/shelf.db)"),
    );
    const logged = vi.spyOn(silentLogger, "error");
    const failed = await accept(issued.inviteId, issued.token, "correct-horse-12");
    const html = await failed.text();
    expect(logged).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: expect.stringContaining("SQLITE_BUSY") }) },
      "unexpected error answered with a generic message",
    );
    expect(failed.status).toBe(400);
    expect(html).toContain("Invalid or expired invite");
    expect(html).not.toContain("SQLITE_BUSY");
    expect(html).not.toContain("shelf.db");
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

describe("signing in to come back to a page", () => {
  const RETURN = /name="return_to" value="([^"]*)"/u;
  const EVIL = ["https://evil.example", "//evil.example", "/\\evil.example", "evil"];

  it("carries a same-site return path through every way of signing in", async () => {
    const { db, shelf } = await testEngine();
    const html = await (
      await testApp(db, shelf).request("/auth/login?return_to=%2Fprojects%2Fa%3Fx%3D1")
    ).text();
    expect(RETURN.exec(html)?.[1]).toBe("/projects/a?x=1");
    expect(html).toContain('data-return-to="/projects/a?x=1"');
    expect(html).toContain("/auth/engine/acme-saml?return_to=%2Fprojects%2Fa%3Fx%3D1");
  });

  it("leaves the return path out when there is none, and when it leaves the site", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    for (const bad of ["", ...EVIL.map((value) => `?return_to=${encodeURIComponent(value)}`)]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one request at a time keeps failures readable
      const html = await (await app.request(`/auth/login${bad}`)).text();
      expect(RETURN.test(html), bad).toBe(false);
      expect(html, bad).toContain('data-return-to="/"');
      expect(html, bad).not.toContain("evil.example");
    }
  });

  it("sends the visitor to the page after signing in, and keeps it after a failed try", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "ada@example.com");
    const attempt = async (password: string, returnTo: string): Promise<Response> => {
      const form = new FormData();
      form.set("email", "ada@example.com");
      form.set("password", password);
      form.set("return_to", returnTo);
      return await app.request("/auth/engine/login", {
        method: "POST",
        headers: { origin: BASE_URL },
        body: form,
      });
    };

    const failed = await attempt("wrongpassword12", "/projects/a?x=1");
    expect(failed.status).toBe(401);
    expect(RETURN.exec(await failed.text())?.[1]).toBe("/projects/a?x=1");

    const ok = await attempt("hunter2hunter2", "/projects/a?x=1");
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/projects/a?x=1");

    for (const evil of [...EVIL, "/a\r\nSet-Cookie: x=1"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- same
      const landed = await attempt("hunter2hunter2", evil);
      expect(landed.headers.get("location"), evil).toBe("/");
    }
  });

  it("goes from a private link's not-found page, through sign-in, to the Storybook", async () => {
    const { db, shelf } = await testEngine();
    const app = testApp(db, shelf);
    await signup(shelf, "ada@example.com");
    const NOW = "2026-01-01T00:00:00.000Z";
    await db.insert(db.tables.projects, {
      id: "p1",
      name: "Hidden",
      slug: "hidden",
      gitRepository: "acme/widgets",
      gitDefaultBranch: "main",
      reviewEnabled: true,
      reviewApprovals: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const builds = new BuildModel(db);
    const build = await builds.create("p1", {
      gitSha: "a".repeat(40),
      gitBranch: "main",
      isDefault: true,
    });
    await builds.update(build.id, { status: "approved" });

    // A teammate opens the private link: the page says nothing about whether the project exists.
    const landing = await app.request("/projects/hidden/storybook", {
      headers: { accept: "text/html" },
    });
    expect(landing.status).toBe(404);
    const signInHref = /href="(\/auth\/login\?return_to=[^"]+)"/u.exec(await landing.text())?.[1];
    expect(signInHref).toBe("/auth/login?return_to=%2Fprojects%2Fhidden%2Fstorybook");

    // The link opens the sign-in page, which remembers where they were going.
    const loginPage = await (await app.request(signInHref ?? "")).text();
    const returnTo = RETURN.exec(loginPage)?.[1];
    expect(returnTo).toBe("/projects/hidden/storybook");

    // Signing in lands them back on the link.
    const form = new FormData();
    form.set("email", "ada@example.com");
    form.set("password", "hunter2hunter2");
    form.set("return_to", returnTo ?? "");
    const signedIn = await app.request("/auth/engine/login", {
      method: "POST",
      headers: { origin: BASE_URL },
      body: form,
    });
    expect(signedIn.headers.get("location")).toBe("/projects/hidden/storybook");
    const cookie = sessionOf(signedIn);

    // Signing in alone reveals nothing: without a role the link still answers 404.
    expect((await app.request("/projects/hidden/storybook", { headers: { cookie } })).status).toBe(
      404,
    );

    // Once they are a member, the same link opens the Storybook.
    const user = await shelf.adapter.check(new Request(BASE_URL, { headers: { cookie } }));
    await new MemberModel(db).set("p1", user?.id ?? "", "viewer");
    const opened = await app.request("/projects/hidden/storybook", { headers: { cookie } });
    expect(opened.status).toBe(302);
    expect(opened.headers.get("location")).toBe(`/projects/hidden/storybook/build/${build.id}/`);
  });
});
