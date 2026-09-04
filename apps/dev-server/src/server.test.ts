import { createShelfRouter } from "@storyshelf/core";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const scratch = mkdtempSync(join(tmpdir(), "storyshelf-dev-server-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("dev server router assembly", () => {
  it("boots and serves the HTML UI and the JSON API", async () => {
    const database = createSqliteDatabase(join(scratch, "shelf.db"));
    await database.migrate();
    const storage = createLocalStorage(scratch);

    const app = createShelfRouter({
      database,
      storage,
      config: { scratchDir: scratch },
    });

    const html = await app.request("/");
    expect(html.status).toBe(200);

    const api = await app.request("/api/v1/projects");
    expect(api.status).toBe(200);
    await expect(api.json()).resolves.toEqual([]);

    await database.close();
  });
});
