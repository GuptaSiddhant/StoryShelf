import { createShelfLogger } from "@storyshelf/core/logger";
import { ProjectModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

async function get(path: string): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await new ProjectModel(db).create({ name: "Docs" });
  const app = createShelfApp({
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  return await (await app.request(path)).text();
}

describe("project settings layout", () => {
  it("lists every section in a vertical sub-nav with the current one active", async () => {
    const html = await get("/projects/docs/settings/tokens");
    expect(html).toContain('aria-label="Settings sections"');
    for (const label of [
      "General",
      "Tests",
      "Labels",
      "Tokens",
      "Webhooks",
      "Notifications",
      "Members",
      "Git status",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(
      /href="\/projects\/docs\/settings\/tokens"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/projects\/docs\/settings\/tokens"/u,
    );
    expect(html.match(/aria-current="page"/gu)?.length).toBeGreaterThanOrEqual(2);
  });

  it("renders tables through the shared Table surface", async () => {
    const pages = await Promise.all(
      ["tokens", "labels", "webhooks"].map((tab) => get(`/projects/docs/settings/${tab}`)),
    );
    for (const html of pages) {
      expect(html).not.toContain("table-wrap");
    }
  });
});
