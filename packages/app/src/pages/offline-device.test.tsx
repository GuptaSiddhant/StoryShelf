import { createShelfLogger } from "@storyshelf/core/logger";
import { ProjectModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { formatBytes } from "./offline-device-model.ts";

async function devicePage(storybookHosting?: { mode: "trusted" | "sandboxed" }): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await new ProjectModel(db).create({ name: "Design system" });
  const app = createShelfApp({
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
    ...(storybookHosting ? { config: { storybookHosting } } : {}),
  });
  const res = await app.request("/profile/offline");
  expect(res.headers.get("cache-control")).toBe("no-store");
  return await res.text();
}

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(500 * 1024 * 1024)).toBe("500 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GB");
  });
});

describe("GET /profile/offline", () => {
  it("lists each project with a keep control and the storage cap in trusted mode", async () => {
    const html = await devicePage();
    expect(html).toContain('data-offline-keep="design-system"');
    expect(html).toContain("Keep all my projects");
    expect(html).toContain("Sync now");
    expect(html).toContain("500 MB");
  });

  it("outside trusted mode says why and offers nothing to keep", async () => {
    const html = await devicePage({ mode: "sandboxed" });
    expect(html).toContain("Offline Storybooks are unavailable here");
    expect(html).not.toContain("data-offline-keep");
    expect(html).not.toContain("Keep all my projects");
  });
});
