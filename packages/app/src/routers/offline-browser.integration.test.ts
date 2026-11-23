/**
 * Real-browser test of offline Storybooks (ADR 0048, decision 3), gated by RUN_INTEGRATION=1: the
 * worker keeps a project, serves it from `/offline/<slug>/` with the network off, downloads only the
 * changed hashes for a second build, and a sign-out clears everything. Chromium treats
 * `http://127.0.0.1` as a secure context, so the worker and `Clear-Site-Data` work without TLS.
 */
import { MemberModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { contentKey, storybookDir } from "@storyshelf/core/utils";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { pino } from "pino";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubAuth } from "../stub-auth.ts";

const SECRET = "offline-browser-secret-1234567890";
const NOW = "2026-01-01T00:00:00.000Z";
const users = [{ id: "view", email: "v@example.com", name: "View", role: "member" as const }];
const auth = stubAuth(null, {
  check: async (request: Request) => {
    const id = /storyshelf_session=(?<id>\w+)/u.exec(request.headers.get("cookie") ?? "")?.groups?.[
      "id"
    ];
    return await Promise.resolve(users.find((user) => user.id === id) ?? null);
  },
});

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const ONE: Record<string, string> = {
  "index.html": `<!doctype html><title>pending</title><h1>Storybook one</h1><script src="./assets/app.js"></script>`,
  "assets/app.js": `document.title = "ran app.js";`,
  "assets/big.js": "x".repeat(50_000),
};
const TWO: Record<string, string> = {
  ...ONE,
  "assets/app.js": `document.title = "ran app.js v2";`,
};

interface Running {
  server: Server;
  base: string;
  requests: string[];
  publishSecondBuild: () => Promise<void>;
}

async function boot(): Promise<Running> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Demo",
    slug: "demo",
    gitRepository: "acme/widgets",
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(db.tables.users, {
    ...users[0]!,
    avatarUrl: null,
    lastLoginAt: null,
    createdAt: NOW,
  });
  await new MemberModel(db).set("p1", "view", "viewer");
  const publish = async (
    id: string,
    files: Record<string, string>,
    createdAt: string,
  ): Promise<void> => {
    await db.insert(db.tables.builds, {
      id,
      projectId: "p1",
      gitSha: id.repeat(20),
      gitBranch: "main",
      isDefault: true,
      public: false,
      status: "approved",
      createdAt,
      updatedAt: createdAt,
    } as never);
    const manifest: Record<string, string> = {};
    for (const [path, text] of Object.entries(files)) {
      manifest[path] = sha(text);
      // oxlint-disable-next-line no-await-in-loop -- three small files
      await storage.write(contentKey(sha(text)), Buffer.from(text));
    }
    await storage.write(
      `${storybookDir("p1", id)}/manifest.json`,
      Buffer.from(JSON.stringify(manifest)),
    );
  };
  await publish("b1", ONE, NOW);
  const app = createShelfApp({
    database: db,
    storage,
    auth,
    logger: pino({ level: "silent" }),
    config: { secret: SECRET, publicBaseUrl: "http://127.0.0.1" },
  });
  await app.lifecycle.setup();
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : (value ?? ""));
    }
    requests.push(`${req.method} ${req.url}`);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers,
    });
    Promise.resolve(app.fetch(request))
      .then(async (response) => {
        res.writeHead(response.status, [
          ...[...response.headers].filter(([name]) => name !== "set-cookie"),
          ...response.headers.getSetCookie().map((line): [string, string] => ["set-cookie", line]),
        ]);
        res.end(Buffer.from(await response.arrayBuffer()));
      })
      .catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    requests,
    publishSecondBuild: async () => await publish("b2", TWO, "2026-02-01T00:00:00.000Z"),
  };
}

/** Post a message to the worker from the page and wait for its answer. */
async function ask(page: Page, data: unknown): Promise<{ ok: boolean; error?: string }> {
  return (await page.evaluate(
    `new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => resolve(event.data);
      navigator.serviceWorker.controller.postMessage(${JSON.stringify(data)}, [channel.port2]);
    })`,
  )) as { ok: boolean; error?: string };
}

async function installWorker(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/api/v1/health`);
  await page.evaluate(
    `navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready)`,
  );
  await page.reload();
  await page.waitForFunction("navigator.serviceWorker.controller !== null");
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")(
  "offline Storybooks in a real browser",
  () => {
    let browser: Browser;
    let context: BrowserContext;
    let running: Running;
    let page: Page;

    beforeAll(async () => {
      browser = await chromium.launch({
        args: ["--proxy-server=direct://", "--proxy-bypass-list=*"],
      });
      running = await boot();
      context = await browser.newContext();
      await context.addCookies([{ name: "storyshelf_session", value: "view", url: running.base }]);
      page = await context.newPage();
      await installWorker(page, running.base);
    });

    afterAll(async () => {
      await browser?.close();
      running?.server.close();
    });

    it("keeps a project, then serves its Storybook from /offline/<slug>/ with the network off", async () => {
      expect(await ask(page, { type: "keep", slug: "demo" })).toMatchObject({ ok: true });
      await context.setOffline(true);
      await page.goto(`${running.base}/offline/demo/`);
      expect(await page.textContent("h1")).toBe("Storybook one");
      await page.waitForFunction('document.title === "ran app.js"');
      await page.goto(`${running.base}/offline`);
      expect(await page.textContent("a")).toContain("Demo");
      await page.goto(`${running.base}/projects`);
      expect(await page.textContent("h1")).toBe("You are offline");
      await context.setOffline(false);
    });

    it("downloads only the changed hashes for a second build", async () => {
      await running.publishSecondBuild();
      running.requests.length = 0;
      await page.goto(`${running.base}/api/v1/health`);
      expect(await ask(page, { type: "sync" })).toMatchObject({ ok: true });
      const downloads = running.requests.filter((line) => line.includes("/storybook/build/"));
      expect(downloads).toEqual(["GET /projects/demo/storybook/build/b2/assets/app.js"]);
      await context.setOffline(true);
      await page.goto(`${running.base}/offline/demo/`);
      await page.waitForFunction('document.title === "ran app.js v2"');
      await context.setOffline(false);
    });

    it("clears the copies, the state and the worker on sign-out", async () => {
      const token = getCsrfToken(SECRET, "view");
      await page.goto(`${running.base}/api/v1/health`);
      const status = await page.evaluate(
        `fetch("/auth/logout", { method: "POST", headers: { "x-csrf-token": ${JSON.stringify(token)} } }).then((r) => r.status)`,
      );
      expect(status).not.toBe(500);
      await page.waitForFunction(
        `navigator.serviceWorker.getRegistrations().then((list) => list.length === 0)`,
      );
      expect(await page.evaluate("caches.keys()")).toEqual([]);
      expect(
        await page.evaluate(`indexedDB.databases().then((dbs) => dbs.map((db) => db.name))`),
      ).toEqual([]);
      await context.setOffline(true);
      await expect(page.goto(`${running.base}/offline/demo/`)).rejects.toThrow(
        /ERR_INTERNET_DISCONNECTED/u,
      );
      await context.setOffline(false);
    });
  },
);
