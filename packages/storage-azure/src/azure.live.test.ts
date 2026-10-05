/**
 * Live Azure Blob storage test — strictly real cloud, no fakes or emulators.
 *
 * Gated on `LIVE_CLOUD=1` so hermetic `turbo test` never touches Azure.
 * The container is pre-provisioned (manually or via `terraform apply` from
 * `storyshelf server init --target azure`); this suite only owns blobs under
 * a unique per-run prefix and deletes them afterwards.
 *
 * Required env when live:
 * - `AZURE_STORAGE_CONNECTION` — storage account connection string
 *   (from `terraform output -json` → `storage_connection_string`)
 * - `LIVE_AZURE_CONTAINER` — existing blob container name.
 */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAzureStorage } from "./index.ts";

const LIVE = process.env["LIVE_CLOUD"] === "1";

function liveConnectionString(): string {
  const value = process.env["AZURE_STORAGE_CONNECTION"];
  if (!value) {
    throw new Error(
      "Live Azure Blob test requires AZURE_STORAGE_CONNECTION (terraform output: storage_connection_string).",
    );
  }
  return value;
}

function liveContainer(): string {
  const container = process.env["LIVE_AZURE_CONTAINER"];
  if (!container) {
    throw new Error("Live Azure Blob test requires LIVE_AZURE_CONTAINER.");
  }
  return container;
}

function runPrefix(): string {
  const run = process.env["GITHUB_RUN_ID"] ?? "local";
  return `live/${run}/${randomUUID()}`;
}

describe.skipIf(!LIVE)("azure blob live (real Azure, gated on LIVE_CLOUD=1)", () => {
  const prefix = runPrefix();
  let storage: StorageAdapter;

  function activeStorage(): StorageAdapter {
    if (!storage) {
      throw new Error("Live Azure Blob harness not initialized");
    }
    return storage;
  }

  beforeAll(async () => {
    storage = createAzureStorage({
      container: liveContainer(),
      prefix,
      connectionString: liveConnectionString(),
    });
    await expect(storage.lifecycle?.health()).resolves.toEqual({ ok: true });
  });

  afterAll(async () => {
    const target = activeStorage();
    const leftovers = await target.list("");
    for (const path of leftovers) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- cleanup is sequential by design
      await target.delete(path);
    }
    await target.lifecycle?.teardown?.();
  });

  it("writes, reads back, and deletes a blob", async () => {
    const target = activeStorage();
    expect(await target.exists("hello.txt")).toBe(false);
    await target.write("hello.txt", Buffer.from("live-shelf", "utf8"));
    expect(await target.exists("hello.txt")).toBe(true);
    const body = await target.read("hello.txt");
    expect(body.toString("utf8")).toBe("live-shelf");
    await target.delete("hello.txt");
    expect(await target.exists("hello.txt")).toBe(false);
  });

  it("lists only blobs under the run prefix", async () => {
    const target = activeStorage();
    await target.write("a/one.txt", Buffer.from("1", "utf8"));
    await target.write("a/two.txt", Buffer.from("2", "utf8"));
    const listed = await target.list("a/");
    expect(listed.toSorted()).toEqual(["a/one.txt", "a/two.txt"]);
    await target.delete("a/one.txt");
    await target.delete("a/two.txt");
  });

  it("round-trips binary bytes exactly", async () => {
    const target = activeStorage();
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    await target.write("blob.bin", bytes);
    expect(await target.read("blob.bin")).toEqual(bytes);
    await target.delete("blob.bin");
  });
});
