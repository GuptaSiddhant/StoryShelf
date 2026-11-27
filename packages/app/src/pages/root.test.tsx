import { createShelfLogger } from "@storyshelf/core/logger";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import type { ShelfApp } from "../app-types.ts";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const user = { id: "user_1", email: "ada@example.com", name: "Ada", role: "admin" as const };

function appFor(options: { signIn: boolean; adminToken?: string }): ShelfApp {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  return createShelfApp({
    database: db,
    storage,
    ...(options.signIn && { auth: stubAuth(user) }),
    logger: createShelfLogger({ level: "silent" }),
    config: { secret: "s", ...(options.adminToken && { adminToken: options.adminToken }) },
  });
}

describe("home page first-run copy", () => {
  it("names the entry button New project, and never Create project", async () => {
    const html = await (await appFor({ signIn: false }).request("/")).text();
    expect(html).toContain(">New project<");
    expect(html).not.toContain("Create project");
  });

  it("leads a signed-in install with no admin token to New project in its tip", async () => {
    const html = await (await appFor({ signIn: true }).request("/")).text();
    expect(html).toContain("Start with New project.");
    expect(html).not.toContain("Create project");
  });
});
