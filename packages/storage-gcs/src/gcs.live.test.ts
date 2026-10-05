/**
 * Live GCS storage test — strictly real cloud, no fakes or emulators.
 *
 * Gated on `LIVE_CLOUD=1` so hermetic `turbo test` never touches GCP.
 * The bucket is pre-provisioned (manually or via `terraform apply` from
 * `storyshelf server init --target gcp`); this suite only owns objects under
 * a unique per-run prefix and deletes them afterwards.
 *
 * Required env when live:
 * - `LIVE_GCS_BUCKET` — existing bucket (from `terraform output -json` → `gcs_bucket`)
 * - `GCP_PROJECT_ID` — GCP project id (optional; defaults to ADC)
 * - Credentials via ADC (`GOOGLE_APPLICATION_CREDENTIALS`, or the
 *   `google-github-actions/auth` step in CI).
 */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGcsStorage } from "./index.ts";

const LIVE = process.env["LIVE_CLOUD"] === "1";

function liveBucket(): string {
  const bucket = process.env["LIVE_GCS_BUCKET"];
  if (!bucket) {
    throw new Error("Live GCS test requires LIVE_GCS_BUCKET (terraform output: gcs_bucket).");
  }
  return bucket;
}

function liveProjectId(): string | undefined {
  return process.env["GCP_PROJECT_ID"];
}

function runPrefix(): string {
  const run = process.env["GITHUB_RUN_ID"] ?? "local";
  return `live/${run}/${randomUUID()}`;
}

describe.skipIf(!LIVE)("gcs live (real GCP, gated on LIVE_CLOUD=1)", () => {
  const prefix = runPrefix();
  let storage: StorageAdapter;

  function activeStorage(): StorageAdapter {
    if (!storage) {
      throw new Error("Live GCS harness not initialized");
    }
    return storage;
  }

  beforeAll(async () => {
    const projectId = liveProjectId();
    storage = projectId
      ? createGcsStorage({ bucket: liveBucket(), prefix, projectId })
      : createGcsStorage({ bucket: liveBucket(), prefix });
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

  it("writes, reads back, and deletes an object", async () => {
    const target = activeStorage();
    expect(await target.exists("hello.txt")).toBe(false);
    await target.write("hello.txt", Buffer.from("live-shelf", "utf8"));
    expect(await target.exists("hello.txt")).toBe(true);
    const body = await target.read("hello.txt");
    expect(body.toString("utf8")).toBe("live-shelf");
    await target.delete("hello.txt");
    expect(await target.exists("hello.txt")).toBe(false);
  });

  it("lists only objects under the run prefix", async () => {
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
