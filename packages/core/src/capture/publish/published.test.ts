import { describe, expect, it } from "vite-plus/test";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { makeStorage } from "../../test-helpers/fake-adapters.ts";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { storybookDir } from "../../utils/paths.ts";
import { publishingOf, publishingOfBuild } from "./published.ts";

const build = { id: "b1", projectId: "p1", status: "pending" as const };

describe("publishingOf", () => {
  it("is success once the manifest exists, whatever the build status", async () => {
    const { storage } = makeStorage();
    await storage.write(`${storybookDir("p1", "b1")}/manifest.json`, Buffer.from("{}"));
    expect(await publishingOf(storage, build, { publishJobOpen: false })).toBe("success");
    expect(
      await publishingOf(storage, { ...build, status: "failed" }, { publishJobOpen: false }),
    ).toBe("success");
  });

  it("waits without a manifest, and failed means the publish failed", async () => {
    const { storage } = makeStorage();
    expect(await publishingOf(storage, build, { publishJobOpen: false })).toBe("pending");
    expect(
      await publishingOf(storage, { ...build, status: "failed" }, { publishJobOpen: false }),
    ).toBe("failure");
    expect(
      await publishingOf(storage, { ...build, status: "cancelled" }, { publishJobOpen: false }),
    ).toBe("failure");
  });

  it("reads as pending without a storage adapter", async () => {
    expect(await publishingOf(undefined, build, { publishJobOpen: false })).toBe("pending");
  });

  it.each([
    ["pending", false, "pending"],
    ["capturing", false, "pending"],
    ["comparing", false, "pending"],
    ["reviewing", false, "unavailable"],
    ["approved", false, "unavailable"],
    ["rejected", false, "unavailable"],
    ["failed", false, "failure"],
    ["cancelled", false, "failure"],
    ["reviewing", true, "pending"],
    ["approved", true, "pending"],
    ["rejected", true, "pending"],
    ["failed", true, "failure"],
  ])(
    "without a manifest, a %s build (publish job open: %s) reads as %s",
    async (status, publishJobOpen, expected) => {
      const { storage } = makeStorage();
      expect(
        await publishingOf(storage, { ...build, status: status as never }, { publishJobOpen }),
      ).toBe(expected);
    },
  );

  it("never calls the content unavailable when storage cannot be read", async () => {
    expect(
      await publishingOf(undefined, { ...build, status: "approved" }, { publishJobOpen: false }),
    ).toBe("pending");
    expect(
      await publishingOf(undefined, { ...build, status: "failed" }, { publishJobOpen: false }),
    ).toBe("failure");
  });

  it("is success for an accepted build whose manifest is there", async () => {
    const { storage } = makeStorage();
    await storage.write(`${storybookDir("p1", "b1")}/manifest.json`, Buffer.from("{}"));
    expect(
      await publishingOf(storage, { ...build, status: "approved" }, { publishJobOpen: false }),
    ).toBe("success");
  });
});

describe("publishingOfBuild", () => {
  const approved = { ...build, status: "approved" as const };

  it("reads the open publish job of a reviewed build from the database", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const jobs = new CaptureJobModel(db);
    expect(await publishingOfBuild({ db, storage }, approved)).toBe("unavailable");

    await jobs.create({ id: "pub1", kind: "publish", buildId: "b1", maxAttempts: 3 }, "2026-01-01");
    expect(await publishingOfBuild({ db, storage }, approved)).toBe("pending");

    await jobs.finishJob("pub1", "failed", "2026-01-02", "broke");
    expect(await publishingOfBuild({ db, storage }, approved)).toBe("unavailable");
  });

  it("does not look at jobs for a published or still-capturing build", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await storage.write(`${storybookDir("p1", "b1")}/manifest.json`, Buffer.from("{}"));
    expect(await publishingOfBuild({ db, storage }, approved)).toBe("success");
    const empty = makeStorage().storage;
    expect(await publishingOfBuild({ db, storage: empty }, { ...build, status: "capturing" })).toBe(
      "pending",
    );
    expect(await publishingOfBuild({ db, storage: empty }, { ...build, status: "failed" })).toBe(
      "failure",
    );
  });
});
