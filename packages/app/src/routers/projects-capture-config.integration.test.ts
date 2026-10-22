import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

async function setup() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Capture config",
    slug: "capture-config",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  const app = createShelfApp({ database: db, storage, logger: silentLogger });
  const patch = async (body: unknown) =>
    await app.request("/api/v1/projects/capture-config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { patch };
}

type Stored = {
  browser?: string;
  browsers?: string | null;
  modesAllowlist?: string | null;
  storybookUrlTtlSeconds?: number | null;
};

describe("PATCH /projects/:slug capture config", () => {
  it("stores the browser list as JSON and keeps `browser` equal to the primary", async () => {
    const { patch } = await setup();
    const response = await patch({ browsers: ["firefox", "chromium", "firefox"] });
    expect(response.status).toBe(200);
    expect((await response.json()) as Stored).toMatchObject({
      browser: "firefox",
      browsers: '["firefox","chromium"]',
    });
  });

  it("returns to a single browser when `browser` is set or `browsers` is null", async () => {
    const { patch } = await setup();
    await patch({ browsers: ["chromium", "webkit"] });
    const single = (await (await patch({ browser: "firefox" })).json()) as Stored;
    expect(single).toMatchObject({ browser: "firefox", browsers: null });

    await patch({ browsers: ["chromium", "webkit"] });
    const cleared = (await (await patch({ browsers: null })).json()) as Stored;
    expect(cleared.browsers).toBeNull();
  });

  it("rejects more than three browsers, empty lists and unknown engines", async () => {
    const { patch } = await setup();
    expect((await patch({ browsers: ["chromium", "firefox", "webkit", "chrome"] })).status).toBe(
      400,
    );
    expect((await patch({ browsers: [] })).status).toBe(400);
    expect((await patch({ browsers: ["opera"] })).status).toBe(400);
  });

  it("stores the mode allowlist and rejects unusable names", async () => {
    const { patch } = await setup();
    const saved = (await (
      await patch({ modesAllowlist: ["Dark", "Dark", "wide"] })
    ).json()) as Stored;
    expect(saved.modesAllowlist).toBe('["Dark","wide"]');

    const bad = await patch({ modesAllowlist: ["***"] });
    expect(bad.status).toBe(400);

    const cleared = (await (await patch({ modesAllowlist: null })).json()) as Stored;
    expect(cleared.modesAllowlist).toBeNull();
  });
});

describe("PATCH /projects/:slug signed URL lifetime", () => {
  it("stores the project's lifetime and clears it with null", async () => {
    const { patch } = await setup();
    const set = (await (await patch({ storybookUrlTtlSeconds: 14_400 })).json()) as Stored;
    expect(set.storybookUrlTtlSeconds).toBe(14_400);
    const cleared = (await (await patch({ storybookUrlTtlSeconds: null })).json()) as Stored;
    expect(cleared.storybookUrlTtlSeconds).toBeNull();
  });

  it("rejects a lifetime outside 60 to 86400 whole seconds", async () => {
    const { patch } = await setup();
    const responses = await Promise.all(
      [59, 86_401, 90.5, "7200"].map(async (bad) => await patch({ storybookUrlTtlSeconds: bad })),
    );
    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
  });
});
