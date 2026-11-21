import { describe, expect, it } from "vitest";
import type { ShelfApp } from "../../app-types.ts";
import { instanceDir, recordingIo, recordRelease, tablesOf } from "../__fixtures__/instance-dir.ts";
import { adminCall, adminTokenOf } from "../admin-call.ts";
import { runServerBin } from "../main.ts";
import { printStorageReport, problemsIn } from "./check-storage.ts";
import { settingChecks } from "./doctor.ts";
import { portOf } from "./serve.ts";

async function migrated(): Promise<ReturnType<typeof instanceDir>> {
  const found = instanceDir({ afterSetup: true });
  expect(await runServerBin(["migrate", "--dir", found.dir], recordingIo(), {})).toBe(0);
  return found;
}

describe("tool commands", () => {
  it("purge runs the instance's own retention", async () => {
    const { dir } = await migrated();
    const io = recordingIo();
    expect(await runServerBin(["purge", "--dir", dir, "--ttl-days", "7"], io, {})).toBe(0);
    expect(io.stdout[0]).toBe("Removed 0 build(s), 0 branch(es) and 0 baseline(s)");
  });

  it("check-storage reports a consistent empty instance and exits 0", async () => {
    const { dir } = await migrated();
    const io = recordingIo();
    expect(await runServerBin(["check-storage", "--dir", dir, "--sample", "5"], io, {})).toBe(0);
    expect(io.stdout.at(-1)).toBe("Storage is consistent with the database.");
  });

  it("never migrate: purge and check-storage leave an unmigrated database untouched", async () => {
    const runs = ["purge", "check-storage"].map(async (command) => {
      const { dir, dataDir } = instanceDir();
      await runServerBin([command, "--dir", dir], recordingIo(), {});
      return tablesOf(dataDir);
    });
    expect(await Promise.all(runs)).toEqual([[], []]);
  });
});

describe("admin call", () => {
  it("takes the configured token, then SHELF_ADMIN_TOKEN, else refuses", () => {
    expect(adminTokenOf({ config: { adminToken: "a" } } as never, { SHELF_ADMIN_TOKEN: "b" })).toBe(
      "a",
    );
    expect(adminTokenOf({} as never, { SHELF_ADMIN_TOKEN: "b" })).toBe("b");
    expect(() => adminTokenOf({} as never, {})).toThrow(/no admin token/u);
  });

  it("surfaces a refused call", async () => {
    const refusing = { fetch: () => new Response("no", { status: 503 }) } as unknown as ShelfApp;
    await expect(adminCall(refusing, "t", "/api/v1/admin/purge", {})).rejects.toThrow(
      /answered 503/u,
    );
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
  it("does not migrate, and says the schema level is unknown", async () => {
    const { dir, dataDir } = instanceDir({ afterSetup: true });
    const io = recordingIo();
    expect(await runServerBin(["doctor", "--dir", dir], io, {})).toBe(0);
    const text = io.stdout.join("\n");
    expect(text).toContain("The instance factory built its options and the app");
    expect(text).toContain("! Schema level: unknown");
    // A real SQLite instance: nothing was created. A job consumer would have needed `capture_jobs`.
    expect(tablesOf(dataDir)).toEqual([]);
  });

  it("reports the level a migration recorded", async () => {
    const { dir, dataDir } = await migrated();
    recordRelease(dataDir, "0.14.0");
    const io = recordingIo();
    expect(await runServerBin(["doctor", "--dir", dir], io, {})).toBe(0);
    expect(io.stdout.join("\n")).toContain("✓ Schema level: migrated by release 0.14.0");
  });

  it("reports a failing factory instead of throwing", async () => {
    const source = `import { defineShelfInstance } from ${JSON.stringify(new URL("../../index.tsx", import.meta.url).pathname)};
export default defineShelfInstance(async () => { throw new Error("SHELF_SECRET is too short"); });
`;
    const io = recordingIo();
    expect(await runServerBin(["doctor", "--dir", instanceDir({ source }).dir], io, {})).toBe(1);
    expect(io.stdout.join("\n")).toContain(
      "✗ The instance factory failed: SHELF_SECRET is too short",
    );
  });

  it("fails when there is no instance module", async () => {
    const io = recordingIo();
    expect(await runServerBin(["doctor", "--dir", "/nonexistent-dir"], io, {})).toBe(1);
    expect(io.stdout[0]).toContain("✗");
  });

  it("settingChecks pass when both are set", () => {
    const checks = settingChecks({ SHELF_PUBLIC_BASE_URL: "https://x" }, "t");
    expect(checks.every((check) => check.status === "pass")).toBe(true);
  });
});

describe("serve port", () => {
  it("prefers the flag, then PORT, then 3000", () => {
    expect(portOf({ port: 1 }, { PORT: "2" })).toBe(1);
    expect(portOf({}, { PORT: "2" })).toBe(2);
    expect(portOf({}, {})).toBe(3000);
  });
});
