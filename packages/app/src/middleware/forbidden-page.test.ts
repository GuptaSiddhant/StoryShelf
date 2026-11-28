import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const signedIn = (role: "member" | "viewer") =>
  stubAuth(
    { id: "ada", email: "ada@example.com", name: "Ada", role },
    {
      check: async (request: Request) =>
        await Promise.resolve(
          (request.headers.get("cookie") ?? "").includes("storyshelf_session=ada")
            ? { id: "ada", email: "ada@example.com", name: "Ada", role }
            : null,
        ),
    },
  );

async function boot(role: "member" | "viewer") {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.users, {
    id: "ada",
    email: "ada@example.com",
    name: "Ada",
    role,
    avatarUrl: null,
    lastLoginAt: null,
    createdAt: NOW,
  });
  const app = createShelfApp({
    database: db,
    storage,
    auth: signedIn(role),
    config: { secret: "s" },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  return app;
}

const browser = { accept: "text/html,application/xhtml+xml", cookie: "storyshelf_session=ada" };

describe("the forbidden page", () => {
  it("answers a signed-in member's admin page with the app's own 403 page", async () => {
    const app = await boot("member");
    const response = await app.request("/admin", { headers: browser });
    const html = await response.text();
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<h1");
    expect(html).toContain("Forbidden");
    expect(html).toContain("You do not have permission to open this page.");
    expect(html).toContain("Go to the home page");
    expect(html).toContain('href="/"');
  });

  it("leaves an API refusal as the JSON envelope", async () => {
    const app = await boot("member");
    const response = await app.request("/api/v1/admin/notification-channels", {
      headers: { accept: "application/json", cookie: "storyshelf_session=ada" },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("<html");
  });
});
