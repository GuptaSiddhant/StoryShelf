import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShelfApp } from "../../app-types.ts";
import { instanceDir, recordingIo } from "../__fixtures__/instance-dir.ts";
import { adminCall } from "../admin-call.ts";
import { loadInstance } from "../instance.ts";
import { checkStorage, printStorageReport, problemsIn } from "./check-storage.ts";
import { doctor, settingChecks } from "./doctor.ts";
import { purge } from "./purge.ts";
import { portOf } from "./serve.ts";

describe("admin commands", () => {
  beforeEach(() => {
    vi.stubEnv("SHELF_ADMIN_TOKEN", "test-admin");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("purge runs the instance's own retention", async () => {
    const io = recordingIo();
    expect(await purge({ dir: instanceDir(), ttlDays: 7 }, io)).toBe(0);
    expect(io.stdout[0]).toBe("Removed 0 build(s), 0 branch(es) and 0 baseline(s)");
  });

  it("check-storage reports a consistent empty instance and exits 0", async () => {
    const io = recordingIo();
    expect(await checkStorage({ dir: instanceDir(), sample: 5 }, io)).toBe(0);
    expect(io.stdout.at(-1)).toBe("Storage is consistent with the database.");
  });

  it("refuses without SHELF_ADMIN_TOKEN", async () => {
    vi.stubEnv("SHELF_ADMIN_TOKEN", "");
    const { app } = await loadInstance(instanceDir());
    await expect(adminCall(app, "/api/v1/admin/purge", {})).rejects.toThrow(/SHELF_ADMIN_TOKEN/u);
  });

  it("surfaces a refused call", async () => {
    const refusing = { fetch: () => new Response("no", { status: 503 }) } as unknown as ShelfApp;
    await expect(adminCall(refusing, "/api/v1/admin/purge", {})).rejects.toThrow(/answered 503/u);
  });
});

describe("storage report", () => {
  const base = {
    buildsChecked: 2,
    baselinesChecked: 1,
    builds: [],
    unreadableManifests: [],
    missingBaselineImages: 0,
    unreferencedBlobs: 4,
    sampled: false,
  };

  it("counts and prints every kind of problem", () => {
    const report = {
      ...base,
      builds: [{ buildId: "b1", missing: 2 }],
      unreadableManifests: ["b2"],
      missingBaselineImages: 1,
      sampled: true,
    };
    expect(problemsIn(report)).toBe(3);
    const io = recordingIo();
    printStorageReport(report, io);
    expect(io.stdout).toContain("Build b1: 2 blob(s) missing from storage");
    expect(io.stdout).toContain("Build b2: manifest unreadable");
    expect(io.stdout).toContain("Unreferenced blobs: not counted (sampled run)");
  });

  it("prints the unreferenced count of a full run", () => {
    const io = recordingIo();
    printStorageReport(base, io);
    expect(io.stdout).toContain("Unreferenced blobs: 4");
  });
});

describe("doctor", () => {
  it("passes on a working instance and warns about unset settings", async () => {
    const io = recordingIo();
    expect(await doctor({ dir: instanceDir() }, io, {})).toBe(0);
    expect(io.stdout.join("\n")).toContain("Adapters set up and migrations applied");
    expect(io.stdout.join("\n")).toContain("! SHELF_PUBLIC_BASE_URL is not set");
  });

  it("fails when the instance module is missing", async () => {
    const io = recordingIo();
    expect(await doctor({ dir: "/nonexistent-dir" }, io, {})).toBe(1);
    expect(io.stdout[0]).toContain("✗");
  });

  it("fails when adapter setup throws", async () => {
    const dir = instanceDir(
      `const fake = { fetch: () => new Response("{}"), lifecycle: { setup: async () => { throw new Error("db down"); }, teardown: async () => {} } };\nexport default fake;\n`,
    );
    const io = recordingIo();
    expect(await doctor({ dir }, io, {})).toBe(1);
    expect(io.stdout.join("\n")).toContain("Adapter setup failed: db down");
  });

  it("settingChecks pass when both are set", () => {
    expect(
      settingChecks({ SHELF_PUBLIC_BASE_URL: "https://x", SHELF_ADMIN_TOKEN: "t" }).every(
        (c) => c.status === "pass",
      ),
    ).toBe(true);
  });
});

describe("serve port", () => {
  it("prefers the flag, then PORT, then 3000", () => {
    expect(portOf({ port: 1 }, { PORT: "2" })).toBe(1);
    expect(portOf({}, { PORT: "2" })).toBe(2);
    expect(portOf({}, {})).toBe(3000);
  });
});
