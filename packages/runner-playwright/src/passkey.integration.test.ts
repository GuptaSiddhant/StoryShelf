/**
 * Real-browser passkey check (gated: `nub run test:integration`).
 *
 * Boots the shelf app on localhost (a secure context), drives Chromium
 * with a CDP virtual authenticator, and walks the whole flow: password
 * login → profile key registration → sign out → passkey login.
 */
import { serve } from "@hono/node-server";
import { createShelfApp } from "@storyshelf/app";
import { createShelfAuth } from "@storyshelf/auth";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";

const PASSWORD = "browser-pass-12";
const EMAIL = "browser@example.com";

/** Grab a free localhost port (closed before the app binds it). */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "localhost", () => {
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return port;
}

async function bootShelf(): Promise<{
  baseURL: string;
  invite: (email: string, password: string) => Promise<void>;
  close: () => Promise<void>;
}> {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-passkey-"));
  const database = createSqliteDatabase(join(dir, "shelf.db"));
  const storage = createLocalStorage(dir);
  const port = await freePort();
  const baseURL = `http://localhost:${port}`;
  const shelf = createShelfAuth({
    db: database,
    secret: "browser-secret-that-is-long-enough-123456",
    baseURL,
    passkeys: {},
  });
  const app = createShelfApp({
    database,
    storage,
    auth: shelf.adapter,
    config: { secret: "browser-secret-that-is-long-enough-123456" },
  });
  await app.lifecycle.setup();
  const server = serve({ fetch: app.fetch, port, hostname: "localhost" });
  await new Promise<void>((resolve) => {
    server.on("listening", () => {
      resolve();
    });
  });
  return {
    baseURL,
    invite: async (email: string, password: string): Promise<void> => {
      const issued = await shelf.adapter.issueInvite({ email, name: "Browser", role: "member" });
      await shelf.adapter.acceptInvite({
        inviteId: issued.inviteId,
        token: issued.token,
        password,
      });
    },
    close: async () => {
      await app.lifecycle.teardown();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("browser passkey flow", () => {
  it("registers a key and signs in with it", async () => {
    const { baseURL, invite, close } = await bootShelf();
    const browser = await chromium.launch();
    try {
      await invite(EMAIL, PASSWORD);
      const context = await browser.newContext();
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
          protocol: "ctap2",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });

      await page.goto(`${baseURL}/auth/login`);
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(`${baseURL}/`);

      await page.goto(`${baseURL}/profile`);
      await page.getByLabel("Key name").fill("Browser key");
      await page.locator("[data-passkey-register]").click();
      await page.getByText("Browser key").waitFor({ timeout: 30_000 });

      await page
        .locator("#main-content")
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      await page.waitForURL(`${baseURL}/auth/login`);

      await page.locator("[data-passkey-login]").click();
      await page.waitForURL(`${baseURL}/`, { timeout: 30_000 });

      await page.goto(`${baseURL}/profile`);
      await page.getByText(EMAIL).waitFor({ timeout: 15_000 });
      const content = await page.content();
      expect(content).toContain(EMAIL);
      expect(content).toContain("Browser key");
    } finally {
      await browser.close();
      await close();
    }
  }, 120_000);
});
