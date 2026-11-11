/**
 * The write rule of ADR 0051, decision 9: a state-changing request that carries a session cookie is
 * refused unless its `Origin` is the portal's or the browser says `Sec-Fetch-Site` is `same-origin` or
 * `none`. It covers `/api/v1` and the auth routes, which `CSRF_PATHS` does not.
 */
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { CROSS_SITE_WRITE_MESSAGE } from "../middleware/same-site-writes.ts";
import { stubAuth } from "../stub-auth.ts";

const SECRET = "write-origin-secret-write-origin-secret";
const PORTAL = "https://shelf.example.com";
const CONTENT = "https://01arz3ndektsv4rrffq69g5fav.shelf.example.com";
const admin = { id: "u1", email: "a@example.com", name: "Ada", role: "admin" as const };
const COOKIES = [
  "storyshelf_session=abc",
  "__Secure-storyshelf_session=abc",
  "__Host-storyshelf_session=abc",
] as const;

function boot(mode: "trusted" | "subdomain" = "trusted") {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  return createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    auth: stubAuth(admin, { hostSessionCookie: true }),
    config: {
      secret: SECRET,
      publicBaseUrl: PORTAL,
      ...(mode === "subdomain"
        ? { storybookHosting: { mode, baseDomain: "shelf.example.com" } }
        : {}),
    },
  });
}

/** The state-changing routes: an API route and a page route, neither of which needs to exist. */
const WRITE_URLS = [`${PORTAL}/api/v1/projects`, `${PORTAL}/auth/engine/login`] as const;

/** POST to every write URL with `headers`; whether each was refused by the write rule. */
async function postAll(
  app: ReturnType<typeof boot>,
  headers: Record<string, string>,
): Promise<boolean[]> {
  const answers = await Promise.all(
    WRITE_URLS.map(async (url) => await app.request(url, { method: "POST", headers })),
  );
  return await Promise.all(answers.map(async (answer) => await refused(answer)));
}

async function refused(response: Response): Promise<boolean> {
  return response.status === 403 && (await response.text()).includes(CROSS_SITE_WRITE_MESSAGE);
}

describe("writes that carry a session cookie", () => {
  it.each(COOKIES)("are refused with no Origin and no Sec-Fetch-Site, for %s", async (cookie) => {
    const app = boot();
    expect(await postAll(app, { cookie })).toEqual([true, true]);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "are refused for %s, JSON on /api/v1",
    async (method) => {
      const response = await boot().request(`${PORTAL}/api/v1/projects`, {
        method,
        headers: {
          cookie: COOKIES[0],
          "sec-fetch-site": "cross-site",
          origin: "https://evil.example",
        },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { message: CROSS_SITE_WRITE_MESSAGE } });
    },
  );

  it.each([
    ["a content host of the same site", { "sec-fetch-site": "same-site", origin: CONTENT }],
    ["a cross-site page", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }],
    ["an opaque origin", { "sec-fetch-site": "cross-site", origin: "null" }],
    ["a same-site request with no Origin", { "sec-fetch-site": "same-site" }],
    ["another port of the portal host", { origin: "https://shelf.example.com:8443" }],
    ["the portal over http", { origin: "http://shelf.example.com" }],
    ["a lookalike origin", { origin: "https://shelf.example.com.evil.example" }],
  ])("are refused from %s", async (_name, headers) => {
    const response = await boot().request(`${PORTAL}/api/v1/projects`, {
      method: "POST",
      headers: { cookie: COOKIES[0], ...headers },
    });
    expect(await refused(response)).toBe(true);
  });

  it.each([
    ["the portal's own page", { "sec-fetch-site": "same-origin" }],
    ["the address bar", { "sec-fetch-site": "none" }],
    ["an Origin that is the portal's", { origin: PORTAL }],
    [
      "the portal's Origin and a same-site fetch",
      { origin: PORTAL, "sec-fetch-site": "same-site" },
    ],
  ])("are let through from %s", async (_name, headers) => {
    const app = boot();
    expect(await postAll(app, { cookie: COOKIES[0], ...headers })).toEqual([false, false]);
  });

  it("are judged against the configured portal origin in subdomain mode", async () => {
    const app = boot("subdomain");
    const cross = await app.request(`${PORTAL}/api/v1/projects`, {
      method: "POST",
      headers: { cookie: COOKIES[2], origin: CONTENT, "sec-fetch-site": "same-site" },
    });
    expect(await refused(cross)).toBe(true);
    const own = await app.request(`${PORTAL}/api/v1/projects`, {
      method: "POST",
      headers: { cookie: COOKIES[2], origin: PORTAL },
    });
    expect(await refused(own)).toBe(false);
  });
});

describe("the rule's reach", () => {
  it("leaves reads alone, whatever their origin", async () => {
    const app = boot();
    const answers = await Promise.all(
      ["GET", "HEAD", "OPTIONS"].map(
        async (method) =>
          await app.request(`${PORTAL}/api/v1/health`, {
            method,
            headers: {
              cookie: COOKIES[0],
              "sec-fetch-site": "cross-site",
              origin: "https://evil.example",
            },
          }),
      ),
    );
    expect(await Promise.all(answers.map(async (answer) => await refused(answer)))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("leaves a request with no session cookie to the routes' own checks", async () => {
    const app = boot();
    const answers = await Promise.all(
      ["", "other=1", "storyshelf_session=", "__Host-storyshelf-grant=x"].map(
        async (cookie) =>
          await app.request(`${PORTAL}/api/v1/projects`, {
            method: "POST",
            headers:
              cookie === ""
                ? { origin: "https://evil.example" }
                : { cookie, origin: "https://evil.example" },
          }),
      ),
    );
    expect(await Promise.all(answers.map(async (answer) => await refused(answer)))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("answers a content host's write with 404, not the portal's refusal", async () => {
    const response = await boot("subdomain").request(`${CONTENT}/api/v1/projects`, {
      method: "POST",
      headers: { cookie: COOKIES[2], origin: CONTENT },
    });
    expect(response.status).toBe(404);
  });
});
