import { describe, expect, it } from "vitest";
import { makeStorage } from "../../test-helpers/fake-adapters.ts";
import { storybookDir } from "../../utils/paths.ts";
import { publishingOf } from "./published.ts";

const build = { id: "b1", projectId: "p1", status: "pending" as const };

describe("publishingOf", () => {
  it("is success once the manifest exists, whatever the build status", async () => {
    const { storage } = makeStorage();
    await storage.write(`${storybookDir("p1", "b1")}/manifest.json`, Buffer.from("{}"));
    expect(await publishingOf(storage, build)).toBe("success");
    expect(await publishingOf(storage, { ...build, status: "failed" })).toBe("success");
  });

  it("waits without a manifest, and failed means the publish failed", async () => {
    const { storage } = makeStorage();
    expect(await publishingOf(storage, build)).toBe("pending");
    expect(await publishingOf(storage, { ...build, status: "failed" })).toBe("failure");
    expect(await publishingOf(storage, { ...build, status: "cancelled" })).toBe("failure");
  });

  it("reads as pending without a storage adapter", async () => {
    expect(await publishingOf(undefined, build)).toBe("pending");
  });
});
