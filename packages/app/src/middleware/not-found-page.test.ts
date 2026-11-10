import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vite-plus/test";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const signedIn = stubAuth(null, {
  check: async (request: Request) =>
    await Promise.resolve(
      (request.headers.get("cookie") ?? "").includes("storyshelf_session=ada")
        ? { id: "ada", email: "ada@example.com", name: "Ada", role: "member" as const }
        : null,
    ),
});

async function boot(options: { auth: boolean }) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.users, {
    id: "ada",
    email: "ada@example.com",
    name: "Ada",
    role: "member",
    avatarUrl: null,
    lastLoginAt: null,
    createdAt: NOW,
  });
  const app = createShelfApp({
    database: db,
    storage,
    ...(options.auth ? { auth: signedIn } : {}),
    config: { secret: "s" },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  return app;
}

const browser = { accept: "text/html,application/xhtml+xml" };

describe("the not-found page", () => {
  it("offers a visitor who is not signed in a sign-in link that returns to the page", async () => {
    const app = await boot({ auth: true });
    const response = await app.request("/projects/ghost/storybook?viewMode=docs", {
      headers: browser,
    });
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Project not found");
    expect(html).toContain(
      'href="/auth/login?return_to=%2Fprojects%2Fghost%2Fstorybook%3FviewMode%3Ddocs"',
    );
    expect(html).toContain("Sign in");
  });

  it("offers a signed-in visitor the home page and no sign-in link", async () => {
    const app = await boot({ auth: true });
    const response = await app.request("/projects/ghost/storybook", {
      headers: { ...browser, cookie: "storyshelf_session=ada" },
    });
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(html).toContain("Go to the home page");
    expect(html).not.toContain("/auth/login");
  });

  it("offers no sign-in link on an instance without sign-in", async () => {
    const app = await boot({ auth: false });
    const response = await app.request("/projects/ghost/storybook", { headers: browser });
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(html).toContain("Go to the home page");
    expect(html).not.toContain("/auth/login");
  });

  it("words a route that does not exist at all as plain 'Not found'", async () => {
    const app = await boot({ auth: false });
    const html = await (await app.request("/no/such/page", { headers: browser })).text();
    expect(html).toContain("Not found");
    expect(html).not.toContain("404 Not Found");
  });

  it("leaves a request that is not a page navigation with the plain answer", async () => {
    const app = await boot({ auth: true });
    const plain = async (path: string, headers: Record<string, string>) => {
      const response = await app.request(path, { headers });
      return { status: response.status, type: response.headers.get("content-type") ?? "" };
    };
    // Not asking for HTML.
    expect(await plain("/projects/ghost/storybook", { accept: "*/*" })).toEqual({
      status: 404,
      type: expect.stringContaining("text/plain"),
    });
    // An HTMX swap, an API call and a signed URL keep what their route sent.
    for (const [path, headers] of [
      ["/projects/ghost/storybook", { ...browser, "HX-Request": "true" }],
      ["/api/v1/no-such-route", browser],
      ["/_s/not-a-token/iframe.html", browser],
    ] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one request at a time keeps failures readable
      const answered = await plain(path, headers);
      expect(answered.status, path).toBe(404);
      expect(answered.type, path).not.toContain("text/html");
    }
  });
});
