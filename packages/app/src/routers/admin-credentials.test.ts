import { createShelfLogger } from "@storyshelf/core/logger";
import { WebhookModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { checkCredentialsAtBoot } from "../credentials.ts";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const OLD = "old-secret-value";
const NEW = "new-secret-value";
const silent = createShelfLogger({ level: "silent" });

async function seedApp(options: { config: Record<string, unknown>; role?: "admin" | "member" }) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await new WebhookModel(db, undefined, OLD).create("p1", {
    url: "https://example.com/hook",
    secret: "whsec_1",
    events: [],
  });
  const app = createShelfApp({
    database: db,
    storage,
    logger: silent,
    config: options.config,
    ...(options.role
      ? { auth: stubAuth({ id: "u1", email: "a@b.c", name: "A", role: options.role }) }
      : {}),
  });
  await app.lifecycle.setup();
  return { app, db };
}

async function csrfFrom(app: { request: (path: string) => Response | Promise<Response> }) {
  const html = await (await app.request("/admin")).text();
  return /name="csrf_token" value="([^"]+)"/u.exec(html)?.[1] ?? "";
}

describe("credential rotation admin", () => {
  it("shows counts and the re-encrypt button while rows use the previous secret", async () => {
    const { app } = await seedApp({ config: { secret: NEW, previousSecret: OLD } });
    const html = await (await app.request("/admin")).text();
    expect(html).toContain("Stored credentials");
    expect(html).toContain("Re-encrypt with current secret");
    expect(html).toContain("Credential encryption");
  });

  it("hides the button when no previousSecret is configured", async () => {
    const { app } = await seedApp({ config: { secret: OLD } });
    const html = await (await app.request("/admin")).text();
    expect(html).toContain("Stored credentials");
    expect(html).not.toContain("Re-encrypt with current secret");
  });

  it("reports unreadable credentials as a failed health entry", async () => {
    const { app } = await seedApp({ config: { secret: "something-else-entirely" } });
    const html = await (await app.request("/admin")).text();
    expect(html).toContain("cannot be decrypted");
  });

  it("re-encrypts through the admin API", async () => {
    const { app, db } = await seedApp({ config: { secret: NEW, previousSecret: OLD } });
    const response = await app.request("/api/v1/admin/credentials/reencrypt", { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reencrypted: 1, failed: 0, unreadable: 0 });
    const [row] = await new WebhookModel(db, undefined, NEW).list("p1");
    expect(new WebhookModel(db, undefined, NEW).decryptSecret(row!)).toBe("whsec_1");
  });

  it("answers 409 from the API when nothing is being rotated", async () => {
    const { app } = await seedApp({ config: { secret: NEW } });
    const response = await app.request("/api/v1/admin/credentials/reencrypt", { method: "POST" });
    expect(response.status).toBe(409);
  });

  it("forbids non-admins from both the API and the page action", async () => {
    const { app } = await seedApp({
      config: { secret: NEW, previousSecret: OLD },
      role: "member",
    });
    const api = await app.request("/api/v1/admin/credentials/reencrypt", { method: "POST" });
    expect(api.status).toBe(403);
    const page = await app.request("/admin/credentials/reencrypt", { method: "POST" });
    expect([401, 403]).toContain(page.status);
  });

  it("requires a CSRF token on the page action and re-encrypts with one", async () => {
    const { app, db } = await seedApp({ config: { secret: NEW, previousSecret: OLD } });
    const rejected = await app.request("/admin/credentials/reencrypt", { method: "POST" });
    expect(rejected.status).toBe(403);

    const token = await csrfFrom(app);
    const accepted = await app.request("/admin/credentials/reencrypt", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `csrf_token=${encodeURIComponent(token)}`,
    });
    expect(accepted.status).toBeLessThan(400);
    const [row] = await new WebhookModel(db, undefined, NEW).list("p1");
    expect(new WebhookModel(db, undefined, NEW).decryptSecret(row!)).toBe("whsec_1");
  });
});

function recordingLogger() {
  const logger = createShelfLogger({ level: "silent" });
  return {
    logger,
    warn: vi.spyOn(logger, "warn"),
    error: vi.spyOn(logger, "error"),
    info: vi.spyOn(logger, "info"),
  };
}

async function dbWithOldRow() {
  const { db } = makeDatabase();
  await new WebhookModel(db, undefined, OLD).create("p1", {
    url: "https://example.com/hook",
    secret: "whsec_1",
    events: [],
  });
  return db;
}

describe("checkCredentialsAtBoot", () => {
  it("only warns when migration is not enabled", async () => {
    const db = await dbWithOldRow();
    const log = recordingLogger();
    await checkCredentialsAtBoot(db, { secret: NEW, previousSecret: OLD }, log.logger);
    expect(log.warn).toHaveBeenCalled();
    expect(await new WebhookModel(db, undefined, NEW).list("p1")).toHaveLength(1);
    const [row] = await new WebhookModel(db, undefined, NEW).list("p1");
    expect(() => new WebhookModel(db, undefined, NEW).decryptSecret(row!)).toThrow();
  });

  it("migrates at boot when migrateCredentialsOnBoot is set", async () => {
    const db = await dbWithOldRow();
    const log = recordingLogger();
    await checkCredentialsAtBoot(
      db,
      { secret: NEW, previousSecret: OLD, migrateCredentialsOnBoot: true },
      log.logger,
    );
    const [row] = await new WebhookModel(db, undefined, NEW).list("p1");
    expect(new WebhookModel(db, undefined, NEW).decryptSecret(row!)).toBe("whsec_1");
    expect(log.info).toHaveBeenCalled();
  });

  it("logs an error for credentials no key can decrypt", async () => {
    const db = await dbWithOldRow();
    const log = recordingLogger();
    await checkCredentialsAtBoot(db, { secret: "unrelated-secret" }, log.logger);
    expect(log.error).toHaveBeenCalled();
  });

  it("warns when migration is requested without a previous secret", async () => {
    const db = await dbWithOldRow();
    const log = recordingLogger();
    await checkCredentialsAtBoot(db, { secret: OLD, migrateCredentialsOnBoot: true }, log.logger);
    expect(log.warn).toHaveBeenCalled();
  });

  it("does nothing without a configured secret", async () => {
    const db = await dbWithOldRow();
    const log = recordingLogger();
    await checkCredentialsAtBoot(db, {}, log.logger);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});
