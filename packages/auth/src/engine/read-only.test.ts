import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { READ_ONLY_ACCOUNT_MESSAGE } from "@storyshelf/core/auth";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { createShelfAuth, type ShelfAuth } from "../engine.ts";
import { READ_ONLY_ENGINE_PATHS } from "./read-only.ts";

const AUTH_DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, ip_address TEXT, user_agent TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE account (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at TEXT, refresh_token_expires_at TEXT, scope TEXT, expires_at TEXT, password TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`;

const ORIGIN = "http://localhost:3000";
const DEMO = "demo@example.test";
const OTHER = "ada@example.test";
const PASSWORD = "correct-horse-battery";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A recording mail sender (password resets need one configured). */
function sender(sent: string[]): Parameters<typeof createShelfAuth>[0]["emailSender"] {
  return {
    metadata: { name: "test", version: "0.0.0", kind: "test", category: "notifier" },
    send: async (message: { to: string }): Promise<void> => {
      sent.push(message.to);
      await Promise.resolve();
    },
  };
}

async function engine(
  sent: string[] = [],
): Promise<{ db: DatabaseAdapter; file: string; shelf: ShelfAuth }> {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-auth-read-only-"));
  dirs.push(dir);
  const seed = new DatabaseSync(join(dir, "test.db"));
  seed.exec(AUTH_DDL);
  seed.close();
  const db = createSqliteDatabase(join(dir, "test.db"));
  await db.lifecycle?.setup({ config: {}, logger: undefined as never });
  const shelf = createShelfAuth({
    db,
    secret: "read-only-secret-that-is-long-enough-1234",
    baseURL: ORIGIN,
    passkeys: {},
    emailSender: sender(sent),
    readOnlyAccounts: ["Demo@Example.test"],
  });
  for (const [email, name] of [
    [DEMO, "Demo"],
    [OTHER, "Ada"],
  ] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- invites are created one after another
    const issued = await shelf.adapter.issueInvite({ email, name, role: "member" });
    // oxlint-disable-next-line eslint/no-await-in-loop -- invites are created one after another
    await shelf.adapter.acceptInvite({ ...issued, password: PASSWORD });
  }
  return { db, file: join(dir, "test.db"), shelf };
}

async function call(
  shelf: ShelfAuth,
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; authorization?: string } = {},
): Promise<Response> {
  const method = init.method ?? "POST";
  return await shelf.auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        ...(method === "GET" ? {} : { "content-type": "application/json" }),
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.authorization ? { authorization: init.authorization } : {}),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(init.body ?? {}) }),
    }),
  );
}

async function signIn(shelf: ShelfAuth, email: string): Promise<string> {
  const res = await call(shelf, "/sign-in/email", { body: { email, password: PASSWORD } });
  expect(res.status).toBe(200);
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function expectRefused(res: Response): Promise<void> {
  expect(res.status).toBe(403);
  expect(((await res.json()) as { message?: string }).message).toBe(READ_ONLY_ACCOUNT_MESSAGE);
}

/** Every engine write a read-only session could reach, with a plausible body. */
const WRITES: { path: string; method?: string; body?: unknown }[] = [
  {
    path: "/change-password",
    body: {
      currentPassword: PASSWORD,
      newPassword: "a-brand-new-password",
      revokeOtherSessions: true,
    },
  },
  { path: "/change-email", body: { newEmail: "mallory@example.test" } },
  { path: "/update-user", body: { name: "Mallory" } },
  { path: "/delete-user", body: { password: PASSWORD } },
  { path: "/revoke-session", body: { token: "anything" } },
  { path: "/revoke-sessions" },
  { path: "/revoke-other-sessions" },
  { path: "/unlink-account", body: { providerId: "credential" } },
  { path: "/link-social", body: { provider: "github" } },
  { path: "/update-session", body: {} },
  { path: "/passkey/generate-register-options", method: "GET" },
  { path: "/passkey/verify-registration", body: { response: {} } },
  { path: "/passkey/delete-passkey", body: { id: "pk" } },
  { path: "/passkey/update-passkey", body: { id: "pk", name: "x" } },
  { path: "/list-sessions", method: "GET" },
];

describe("read-only engine guard", () => {
  it("lets the account sign in, read its session and sign out", async () => {
    const { shelf } = await engine();
    const cookie = await signIn(shelf, DEMO);
    const session = await call(shelf, "/get-session", { method: "GET", cookie });
    expect(session.status).toBe(200);
    const user = await shelf.adapter.check(new Request(`${ORIGIN}/`, { headers: { cookie } }));
    expect(user?.readOnly).toBe(true);
    expect(shelf.adapter.isReadOnlyAccount?.("DEMO@example.test")).toBe(true);
    const out = await call(shelf, "/sign-out", { cookie });
    expect(out.status).toBe(200);
    expect(
      await shelf.adapter.check(new Request(`${ORIGIN}/`, { headers: { cookie } })),
    ).toBeNull();
  }, 30_000);

  it("refuses every engine write of the account's session", async () => {
    const { shelf } = await engine();
    const cookie = await signIn(shelf, DEMO);
    for (const write of WRITES) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one session walks the endpoints in turn
      await expectRefused(await call(shelf, write.path, { ...write, cookie }));
    }
    // The password still works and the session is still there.
    expect(await signIn(shelf, DEMO)).toContain("storyshelf_session=");
    const still = await shelf.adapter.check(new Request(`${ORIGIN}/`, { headers: { cookie } }));
    expect(still?.email).toBe(DEMO);
  }, 30_000);

  it("is not bypassed by an Authorization header next to the cookie", async () => {
    const { shelf } = await engine();
    const cookie = await signIn(shelf, DEMO);
    await expectRefused(
      await call(shelf, "/change-password", {
        cookie,
        authorization: "Bearer not-a-session",
        body: { currentPassword: PASSWORD, newPassword: "a-brand-new-password" },
      }),
    );
  }, 30_000);

  it("refuses a reset or verification mail for the account while signed out", async () => {
    const sent: string[] = [];
    const { shelf } = await engine(sent);
    // Invites mail their link; only what follows counts.
    sent.length = 0;
    await expectRefused(
      await call(shelf, "/request-password-reset", { body: { email: "DEMO@example.test" } }),
    );
    await expectRefused(await call(shelf, "/send-verification-email", { body: { email: DEMO } }));
    expect(sent).toEqual([]);
    const other = await call(shelf, "/request-password-reset", { body: { email: OTHER } });
    expect(other.status).toBe(200);
    expect(sent).toEqual([OTHER]);
  }, 30_000);

  it("refuses a reset token minted for the account", async () => {
    const { file, shelf } = await engine();
    const cookie = await signIn(shelf, DEMO);
    const user = await shelf.adapter.check(new Request(`${ORIGIN}/`, { headers: { cookie } }));
    const now = new Date().toISOString();
    const raw = new DatabaseSync(file);
    raw
      .prepare(
        "INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "v1",
        "reset-password:planted",
        user?.id ?? "",
        new Date(Date.now() + 60_000).toISOString(),
        now,
        now,
      );
    raw.close();
    await expectRefused(
      await call(shelf, "/reset-password", {
        body: { token: "planted", newPassword: "a-brand-new-password" },
      }),
    );
    expect(await signIn(shelf, DEMO)).toContain("storyshelf_session=");
  }, 30_000);

  it("leaves every other account alone", async () => {
    const { shelf } = await engine();
    const cookie = await signIn(shelf, OTHER);
    const user = await shelf.adapter.check(new Request(`${ORIGIN}/`, { headers: { cookie } }));
    expect(user?.readOnly).toBeUndefined();
    const res = await call(shelf, "/update-user", { cookie, body: { name: "Ada L." } });
    expect(res.status).toBe(200);
  }, 30_000);

  it("allows only sign-in, sign-out and session reads", () => {
    expect(
      [...READ_ONLY_ENGINE_PATHS].filter(
        (path) =>
          !/^\/(?:sign-in|sign-out|get-session|callback|sso\/(?:callback|saml2\/sp)|passkey\/(?:generate-authenticate-options|verify-authentication)|ok|error)/u.test(
            path,
          ),
      ),
    ).toEqual([]);
  });
});
