/**
 * Real-browser tests of `subdomain` hosting (ADR 0051, decisions 5 and 9), gated by RUN_INTEGRATION=1.
 * One https server answers on `shelf.test:<port>` (the portal) and on `<build-id>.shelf.test:<port>`
 * (content hosts). Chromium maps every `*.shelf.test` name to the loopback address with
 * `--host-resolver-rules`, so no DNS or /etc/hosts edit is needed, and trusts the throwaway
 * certificate generated here. `shelf.test` is not a public suffix, so the portal and every content
 * host are one *site*, as `shelf.example.com` and its builds are in production (a `*.localhost` name
 * would be a suffix of its own: each host a separate site, which hides the same-site attack). The
 * browser itself decides cookies, Fetch Metadata and Cross-Origin-Resource-Policy, which is the
 * point: these cases cannot be proven with `app.request`.
 */
import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { storybookDir } from "@storyshelf/core/utils";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const A = "01ARZ3NDEKTSV4RRFFQ69G5FAV"; // private: the attacker's own build
const B = "01ARZ3NDEKTSV4RRFFQ69G5FAW"; // private: the victim's build
const C = "01ARZ3NDEKTSV4RRFFQ69G5FAX"; // public: the control
const SECRET = "browser-secret-browser-secret-1234";
const admin = { id: "u1", email: "a@example.com", name: "Ada", role: "admin" as const };
const COOKIE = "__Host-storyshelf-grant";

const DOMAIN = "shelf.test";
const hostOf = (port: number, id: string): string =>
  `https://${id.toLowerCase()}.${DOMAIN}:${port}`;
const portalOf = (port: number): string => `https://${DOMAIN}:${port}`;

/** A throwaway certificate for `shelf.test` and `*.shelf.test`: the key and certificate PEMs. */
function makeCertificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-subdomain-"));
  try {
    const out = { key: join(dir, "k.pem"), cert: join(dir, "c.pem") };
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1"]
        .concat(["-keyout", out.key, "-out", out.cert, "-subj", `/CN=${DOMAIN}`])
        .concat(["-addext", `subjectAltName=DNS:${DOMAIN},DNS:*.${DOMAIN}`]),
      { stdio: "ignore" },
    );
    return { key: readFileSync(out.key, "utf8"), cert: readFileSync(out.cert, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function project(): Project {
  return {
    id: "p1",
    name: "Test",
    slug: "test-project",
    gitRepository: "owner/repo",
    gitDefaultBranch: "main",
    pixelThreshold: 0.1,
    maxDiffRatio: 0.01,
    publicBranchRegex: null,
    executePlay: false,
    playTimeoutMs: 10_000,
    storybookMeta: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function build(id: string, isPublic: boolean): Build {
  return {
    id,
    projectId: "p1",
    gitSha: `sha-${id}`,
    gitBranch: "feature/x",
    isDefault: false,
    authorEmail: null,
    authorName: null,
    message: null,
    public: isPublic,
    status: "approved",
    snapshotCount: 0,
    changedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    inheritedCount: 0,
    affectedOnly: true,
    baselineSha: null,
    changedFiles: null,
    affectedImportPaths: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The attacker's page (build A): tries to read, and to embed, another build's script. */
const attackerPage = (target: string): string => `<!doctype html><title>pending</title><script>
const out = {};
const report = () => { document.title = JSON.stringify(out); };
const s = document.createElement("script");
s.src = "${target}/assets/leak.js";
s.onload = () => { out.script = "loaded"; report(); };
s.onerror = () => { out.script = "blocked"; report(); };
document.head.append(s);
fetch("${target}/assets/leak.js", { credentials: "include" }).then(
  () => { out.fetch = "read"; report(); },
  () => { out.fetch = "blocked"; report(); },
);
</script>`;

const unavailable = (): Promise<Response> => Promise.resolve(new Response("", { status: 503 }));

const cookieNames = async (context: BrowserContext, url: string): Promise<string[]> =>
  (await context.cookies(url)).map((cookie) => cookie.name);

/** Wait until the attacker's page has reported both results in its title. */
async function attackResult(page: Page): Promise<{ script?: string; fetch?: string }> {
  await page.waitForFunction('/"script"/u.test(document.title) && /"fetch"/u.test(document.title)');
  return JSON.parse(await page.title()) as { script?: string; fetch?: string };
}

/** Page scripts are strings: this file runs in Node, where `document` is not a global. */
const loadScript = async (page: Page, url: string): Promise<string> =>
  await page.evaluate(
    `new Promise((resolve) => { const s = document.createElement("script"); s.src = ${JSON.stringify(url)}; s.onload = () => resolve("loaded"); s.onerror = () => resolve("blocked"); document.head.append(s); })`,
  );

const loadImage = async (page: Page, url: string): Promise<string> =>
  await page.evaluate(
    `new Promise((resolve) => { const i = new Image(); i.onload = () => resolve("loaded"); i.onerror = () => resolve("error"); i.src = ${JSON.stringify(url)}; })`,
  );

const sendNoCors = async (page: Page, url: string): Promise<string> =>
  await page.evaluate(
    `fetch(${JSON.stringify(url)}, { mode: "no-cors", credentials: "include" }).then(() => "sent", () => "failed")`,
  );

interface Running {
  server: Server;
  port: number;
}

/** A node server in front of `app.fetch`, on a free port that is in the app's own configuration. */
async function startServer(
  user: typeof admin | null,
  tls: { key: string; cert: string },
): Promise<Running> {
  let handler: (request: Request) => Promise<Response> = unavailable;
  const server = createServer(tls, (req, res) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : (value ?? ""));
    }
    const url = `https://${req.headers.host ?? DOMAIN}${req.url ?? "/"}`;
    handler(new Request(url, { method: req.method, headers }))
      .then(async (response) => {
        res.writeHead(response.status, [
          ...[...response.headers].filter(([name]) => name !== "set-cookie"),
          ...response.headers.getSetCookie().map((line): [string, string] => ["set-cookie", line]),
        ]);
        res.end(Buffer.from(await response.arrayBuffer()));
      })
      .catch(() => {
        res.writeHead(500).end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, project());
  for (const [id, isPublic] of [
    [A, false],
    [B, false],
    [C, true],
  ] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- three rows, in order
    await db.insert(db.tables.builds, build(id, isPublic));
    const dir = storybookDir("p1", id);
    objects.set(`${dir}/index.html`, Buffer.from(attackerPage(hostOf(port, B))));
    objects.set(`${dir}/iframe.html`, Buffer.from("<html>preview</html>"));
    objects.set(`${dir}/assets/leak.js`, Buffer.from(`window.__leak = "${id}";`));
  }
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    auth: stubAuth(user, { hostSessionCookie: true }),
    config: {
      secret: SECRET,
      publicBaseUrl: portalOf(port),
      storybookHosting: { mode: "subdomain", baseDomain: DOMAIN },
    },
  });
  await app.lifecycle.setup();
  handler = async (request) => await app.fetch(request);
  return { server, port };
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")(
  "subdomain hosting in a real browser",
  () => {
    let browser: Browser;
    let tls: { key: string; cert: string };
    const running: Running[] = [];

    beforeAll(async () => {
      browser = await chromium.launch({
        args: [
          // The sandbox forces an egress proxy on https; the test talks to loopback only.
          "--proxy-server=direct://",
          "--proxy-bypass-list=*",
          `--host-resolver-rules=MAP ${DOMAIN} 127.0.0.1, MAP *.${DOMAIN} 127.0.0.1`,
        ],
        ...(process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"]
          ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"] }
          : {}),
      });
      tls = makeCertificate();
    });
    afterAll(async () => {
      await browser.close();
      for (const { server } of running) {
        server.close();
      }
    });

    async function start(user: typeof admin | null = admin): Promise<number> {
      const started = await startServer(user, tls);
      running.push(started);
      return started.port;
    }

    const openContext = async (): Promise<BrowserContext> =>
      await browser.newContext({ ignoreHTTPSErrors: true });

    it("signs the viewer in to a private build through the portal, the exchange and a host-only cookie", async () => {
      const port = await start();
      const context = await openContext();
      const page = await context.newPage();
      await page.goto(`${portalOf(port)}/_/${A}/`);
      expect(page.url()).toBe(`${hostOf(port, A)}/`);
      const cookies = await context.cookies(hostOf(port, A));
      const grant = cookies.find((cookie) => cookie.name === COOKIE);
      expect(grant).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
      expect(grant?.domain.startsWith(".")).toBe(false);
      expect(await cookieNames(context, hostOf(port, B))).toEqual([]);
      expect(await cookieNames(context, portalOf(port))).toEqual([]);
      await context.close();
    });

    it("blocks build A's page from reading or embedding build B's private files", async () => {
      const port = await start();
      const context = await openContext();
      const victim = await context.newPage();
      await victim.goto(`${portalOf(port)}/_/${B}/assets/leak.js`);
      expect(await cookieNames(context, hostOf(port, B))).toContain(COOKIE);
      const attacker = await context.newPage();
      await attacker.goto(`${portalOf(port)}/_/${A}/`);
      expect(await attackResult(attacker)).toEqual({ script: "blocked", fetch: "blocked" });
      expect(await attacker.evaluate("window.__leak")).toBeUndefined();
      await context.close();
    });

    it("control: the same page does load a public build's script", async () => {
      const port = await start();
      const context = await openContext();
      const page = await context.newPage();
      await page.goto(`${portalOf(port)}/_/${A}/`);
      await attackResult(page);
      const loaded = await loadScript(page, `${hostOf(port, C)}/assets/leak.js`);
      expect(loaded).toBe("loaded");
      await context.close();
    });

    it("refuses a cookie from build A on build B's host: the host sends the browser back to the portal", async () => {
      const port = await start();
      const context = await openContext();
      const first = await context.newPage();
      await first.goto(`${portalOf(port)}/_/${A}/`);
      const grantA = (await context.cookies(hostOf(port, A))).find(
        (cookie) => cookie.name === COOKIE,
      );
      expect(grantA).toBeDefined();
      const fresh = await openContext();
      await fresh.addCookies([
        {
          name: COOKIE,
          value: grantA?.value ?? "",
          domain: new URL(hostOf(port, B)).hostname,
          path: "/",
          secure: true,
          httpOnly: true,
        },
      ]);
      const page = await fresh.newPage();
      const statuses: Array<[string, number]> = [];
      page.on("response", (response) => {
        statuses.push([new URL(response.url()).host, response.status()]);
      });
      await page.goto(`${hostOf(port, B)}/assets/leak.js`);
      // The first answer on B's host was a redirect to the portal, not the file.
      expect(statuses[0]).toEqual([new URL(hostOf(port, B)).host, 302]);
      expect(statuses.some(([host]) => host === `${DOMAIN}:${port}`)).toBe(true);
      // The cookie B ends up with is B's own, not A's.
      const grantB = (await fresh.cookies(hostOf(port, B))).find(
        (cookie) => cookie.name === COOKIE,
      );
      expect(grantB?.value).not.toBe(grantA?.value);
      await context.close();
      await fresh.close();
    });

    it("refuses an exchange that is not a navigation, in the browser and from a script", async () => {
      const port = await start();
      const context = await openContext();
      const page = await context.newPage();
      await page.goto(`${portalOf(port)}/_/${A}/`);
      await attackResult(page);
      // The portal hands out the exchange URL only to a navigation; take one from the redirect chain.
      const exchangeUrl = await (async () => {
        const probe = await openContext();
        const probePage = await probe.newPage();
        let url = "";
        probePage.on("response", (response) => {
          if (response.url().includes("/_x/")) {
            url = response.url();
          }
        });
        await probePage.goto(`${portalOf(port)}/_/${B}/`);
        await probe.close();
        return url;
      })();
      expect(exchangeUrl).toContain(`${B.toLowerCase()}.${DOMAIN}`);
      const fetched = await sendNoCors(page, exchangeUrl);
      expect(["sent", "failed"]).toContain(fetched);
      const image = await loadImage(page, exchangeUrl);
      expect(image).toBe("error");
      expect(await cookieNames(context, hostOf(port, B))).toEqual([]);
      // Node cannot resolve `*.shelf.test`: ask the loopback address and name the host in the header.
      const direct = await context.request.get(
        exchangeUrl.replace(/\/\/[^/]+/u, `//127.0.0.1:${port}`),
        {
          headers: { host: new URL(exchangeUrl).host },
          ignoreHTTPSErrors: true,
        },
      );
      expect(direct.status()).toBe(404);
      expect(await cookieNames(context, hostOf(port, B))).toEqual([]);
      await context.close();
    });

    it("gives a viewer with no role nothing: no redirect, no cookie", async () => {
      const port = await start(null);
      const context = await openContext();
      const page = await context.newPage();
      const response = await page.goto(`${portalOf(port)}/_/${B}/`);
      expect(new URL(page.url()).host).toBe(`${DOMAIN}:${port}`);
      expect(response?.ok()).toBe(false);
      expect(await cookieNames(context, hostOf(port, B))).toEqual([]);
      await context.close();
    });
  },
);
