import { describe, expect, it } from "vitest";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { createDatabaseCaptureQueue } from "./index.ts";

describe("database queue lifecycle", () => {
  it("sets up and tears down idempotently, releasing a waiting poll", async () => {
    const queue = createDatabaseCaptureQueue(makeDatabase().db);
    await queue.lifecycle.setup({} as never);
    await queue.lifecycle.setup({} as never);
    const waiting = queue.poll({ waitMs: 60_000 });
    await queue.lifecycle.teardown();
    await queue.lifecycle.teardown();
    expect(await waiting).toBeNull();
  });

  it("reports health from a primary-key read", async () => {
    const { db } = makeDatabase();
    expect(await createDatabaseCaptureQueue(db).lifecycle.health()).toEqual({ ok: true });
    const broken = createDatabaseCaptureQueue({
      ...db,
      get: async () => {
        throw new Error("gone");
      },
    });
    expect(await broken.lifecycle.health()).toEqual({ ok: false, detail: "gone" });
  });
});
