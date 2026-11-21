import { storageContractSuite } from "@storyshelf/core/test-helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeKvService } from "./fake-kv-service.ts";
import { createKvStorage } from "./kv-storage.ts";

beforeEach(() => {
  vi.stubGlobal("fetch", fakeKvService("secret-token"));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// The shared contract: the same cases every built-in storage adapter passes.
storageContractSuite("kv-http", () =>
  createKvStorage({ baseUrl: "http://kv.test", token: "secret-token" }),
);

describe("kv-http storage", () => {
  it("refuses a path that climbs out of its prefix", async () => {
    const storage = createKvStorage({ baseUrl: "http://kv.test", token: "secret-token" });
    await expect(storage.read("../other")).rejects.toThrow("Unsafe storage path");
  });

  it("reports an unreachable service as not healthy, without the token", async () => {
    const storage = createKvStorage({ baseUrl: "http://kv.test", token: "wrong-token" });
    const health = await storage.lifecycle?.health();
    expect(health?.ok).toBe(false);
    expect(JSON.stringify(health)).not.toContain("wrong-token");
  });
});
