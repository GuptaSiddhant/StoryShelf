import { LabelModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

/** The sign-in gate skips only the published-Storybook routes: a `/storybook` elsewhere does not open it. */
const T0 = "2026-01-01T00:00:00.000Z";
const apps: ReturnType<typeof createShelfApp>[] = [];
afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
});

async function anonymousApp() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "App",
    slug: "app",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "sha-b1000",
    gitBranch: "main",
    isDefault: true,
    public: true,
    status: "approved",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  await new LabelModel(db).attach("p1", "b1", "branch", "main");
  const app = createShelfApp({
    database: db,
    storage,
    auth: stubAuth(null),
    logger: pino({ level: "silent" }),
  });
  apps.push(app);
  return app;
}

describe("the sign-in gate", () => {
  it.each([
    "/projects/app/components/storybook",
    "/projects/app/components/src/storybook/Button.stories.tsx",
    "/projects/app/components/storybook?path=../ui/Button.stories.tsx",
    "/projects/app/labels/release/storybook",
    "/projects/app/builds/b1/storybook",
    "/projects/app/settings/storybook",
  ])("sends an anonymous visitor to login for %s", async (link) => {
    const response = await (await anonymousApp()).request(link);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/login");
  });

  it.each([
    [
      createUrlBuilder("").storybookLabel("app", "branch", "main"),
      302,
      "/projects/app/storybook/build/b1/",
    ],
    ["/projects/app/storybook", 302, "/projects/app/storybook/build/b1/"],
    ["/projects/app/storybook/build/b1/", 200, null],
  ])(
    "serves the published route %s to an anonymous visitor (%i, redirect %s), not the login page",
    async (link, status, location) => {
      const response = await (await anonymousApp()).request(link);
      expect(response.status).toBe(status);
      expect(response.headers.get("location")).toBe(location);
    },
  );
});
