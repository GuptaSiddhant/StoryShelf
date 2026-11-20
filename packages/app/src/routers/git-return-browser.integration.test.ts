/**
 * Real-browser check of ADR 0054, decision 5, gated by RUN_INTEGRATION=1: in `subdomain` mode the
 * portal's session cookie is `__Host-storyshelf_session` (SameSite=Lax), and GitHub's return from
 * the App manifest flow is a cross-site, top-level `GET`. The browser must still send the cookie,
 * or the session-bound `state` would never match. A stand-in git host on another site answers with
 * a redirect to the portal, as GitHub does; Chromium decides what the request carries.
 */
import { GitSetupStateModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const DOMAIN = "shelf.test";
const GIT_HOST = "git.example.test";
const SESSION = "viewer-session";
const admin = { id: "u1", email: "a@example.com", name: "Ada", role: "admin" as const };

/** A throwaway certificate; the browser is told to ignore its trust anyway. */
function makeCertificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-git-return-"));
  try {
    const out = { key: join(dir, "k.pem"), cert: join(dir, "c.pem") };
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1"]
        .concat(["-keyout", out.key, "-out", out.cert, "-subj", `/CN=${DOMAIN}`])
        .concat(["-addext", `subjectAltName=DNS:${DOMAIN},DNS:${GIT_HOST}`]),
      { stdio: "ignore" },
    );
    return { key: readFileSync(out.key, "utf8"), cert: readFileSync(out.cert, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Seen {
  path: string;
  site: string | undefined;
  session: boolean;
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")(
  "the GitHub App return in a real browser (subdomain mode)",
  () => {
    let browser: Browser;
    let server: Server;
    let portal = "";
    let state = "";
    const seen: Seen[] = [];

    beforeAll(async () => {
      const { db } = makeDatabase();
      const { storage } = makeStorage();
      let app: ReturnType<typeof createShelfApp> | undefined;
      server = createServer(makeCertificate(), (req, res) => {
        const host = (req.headers.host ?? "").split(":")[0];
        if (host === GIT_HOST) {
          // GitHub's page, whose button creates the App and redirects to `redirect_url` with the
          // code and the state: a navigation the git host's own page starts.
          if (req.url === "/create") {
            res.writeHead(302, {
              location: `${portal}/admin/git/github/return?code=one-time-code&state=${state}`,
            });
          } else {
            res.writeHead(200, { "content-type": "text/html" });
            res.write(
              '<!doctype html><form method="post" action="/create"><button>Create GitHub App</button></form>',
            );
          }
          res.end();
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          headers.set(name, Array.isArray(value) ? value.join(", ") : (value ?? ""));
        }
        seen.push({
          path: req.url ?? "",
          site: headers.get("sec-fetch-site") ?? undefined,
          session: (headers.get("cookie") ?? "").includes(`__Host-storyshelf_session=${SESSION}`),
        });
        const request = new Request(`https://${req.headers.host ?? DOMAIN}${req.url ?? "/"}`, {
          method: req.method,
          headers,
        });
        Promise.resolve(app?.fetch(request) ?? new Response("", { status: 503 }))
          .then(async (response) => {
            res.writeHead(response.status, [...response.headers]);
            res.end(Buffer.from(await response.arrayBuffer()));
          })
          .catch(() => {
            res.writeHead(500).end();
          });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      portal = `https://${DOMAIN}:${(server.address() as AddressInfo).port}`;
      app = createShelfApp({
        database: db,
        storage,
        logger: pino({ level: "silent" }),
        auth: stubAuth(admin, { hostSessionCookie: true }),
        config: {
          secret: "git-return-secret-git-return-secret",
          publicBaseUrl: portal,
          storybookHosting: { mode: "subdomain", baseDomain: DOMAIN },
        },
      });
      await app.lifecycle.setup();
      state = await new GitSetupStateModel(db).issue(SESSION, { name: "Acme", comment: true });
      browser = await chromium.launch({
        args: [
          "--proxy-server=direct://",
          "--proxy-bypass-list=*",
          `--host-resolver-rules=MAP ${DOMAIN} 127.0.0.1, MAP ${GIT_HOST} 127.0.0.1`,
        ],
        ...(process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"]
          ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"] }
          : {}),
      });
    });

    afterAll(async () => {
      await browser.close();
      server.close();
    });

    const returnFromGitHost = async (withSession: boolean): Promise<string> => {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      if (withSession) {
        await context.addCookies([
          {
            name: "__Host-storyshelf_session",
            value: SESSION,
            domain: DOMAIN,
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
      }
      const page = await context.newPage();
      await page.goto(`https://${GIT_HOST}:${new URL(portal).port}/settings/apps/new`);
      await Promise.all([
        page.waitForURL((url) => url.pathname === "/admin/git/github/return"),
        page.click("button"),
      ]);
      const text = await page.locator("main").innerText();
      await context.close();
      return text;
    };

    it("carries the portal's session cookie on the cross-site return, so the state matches", async () => {
      const text = await returnFromGitHost(true);
      expect(text).toContain("Confirm the GitHub App");
      const back = seen.findLast((request) => request.path.startsWith("/admin/git/github/return"));
      expect(back).toEqual(expect.objectContaining({ site: "cross-site", session: true }));
    });

    it("control: without that session the same return cannot be confirmed", async () => {
      expect(await returnFromGitHost(false)).toContain("This setup cannot be finished");
    });
  },
);
