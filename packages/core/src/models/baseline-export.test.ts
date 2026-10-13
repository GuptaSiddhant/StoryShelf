import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import type { Baseline } from "../schema/baseline.ts";
import { makeStorage } from "../test-helpers/fake-adapters.ts";
import {
  BASELINE_ARCHIVE_LIMITS,
  BaselineArchiveError,
  baselineManifestSchema,
} from "./baseline-archive.ts";
import { exportBaselineArchive } from "./baseline-export.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function row(storyId: string, branch: string, browser = "chromium"): Baseline {
  return {
    id: `${storyId}-${branch}-${browser}`,
    projectId: "p1",
    storyId,
    viewportName: "desktop",
    branch,
    snapshotId: null,
    screenshotPath: `p1/${branch}/${storyId}/${browser}.png`,
    infraHash: null,
    mode: null,
    browser,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function exported(rows: Baseline[], branch?: string): Promise<AdmZip> {
  const { storage } = makeStorage();
  await Promise.all(rows.map(async (item) => await storage.write(item.screenshotPath, PNG)));
  const parts: Buffer[] = [];
  const stream = exportBaselineArchive(storage, rows, {
    branch,
    project: "demo",
    now: () => new Date(NOW),
  });
  for await (const chunk of stream) {
    parts.push(chunk);
  }
  return new AdmZip(Buffer.concat(parts));
}

describe("exportBaselineArchive", () => {
  it("writes images mirroring the storage layout plus a manifest last", async () => {
    const zip = await exported([row("b--x", "main"), row("a--y", "main", "firefox")]);
    expect(zip.getEntries().map((entry) => entry.entryName)).toEqual([
      "baselines/main/a--y/desktop~firefox.png",
      "baselines/main/b--x/desktop.png",
      "manifest.json",
    ]);
    const manifest = baselineManifestSchema.parse(
      JSON.parse(String(zip.readFile("manifest.json"))),
    );
    expect(manifest).toMatchObject({ project: "demo", branch: null, exportedAt: NOW, skipped: [] });
    expect(manifest.baselines.map((entry) => entry.storyId)).toEqual(["a--y", "b--x"]);
  });

  it("filters by branch", async () => {
    const zip = await exported([row("a", "main"), row("a", "feature")], "feature");
    const manifest = JSON.parse(String(zip.readFile("manifest.json"))) as { branch: string };
    expect(manifest.branch).toBe("feature");
    expect(zip.getEntries()).toHaveLength(2);
  });

  it("lists baselines with unreadable images as skipped", async () => {
    const { storage } = makeStorage();
    const parts: Buffer[] = [];
    for await (const chunk of exportBaselineArchive(storage, [row("gone", "main")])) {
      parts.push(chunk);
    }
    const zip = new AdmZip(Buffer.concat(parts));
    const manifest = JSON.parse(String(zip.readFile("manifest.json"))) as Record<string, unknown>;
    expect(manifest.baselines).toEqual([]);
    expect(manifest.skipped).toEqual([
      { storyId: "gone", viewport: "desktop", browser: "chromium", branch: "main" },
    ]);
  });

  it("refuses to export more than an archive may hold, before streaming", () => {
    const { storage } = makeStorage();
    const rows = Array.from(
      { length: BASELINE_ARCHIVE_LIMITS.maxBaselines + 1 },
      (_unused, index) => row(`s${index}`, "main"),
    );
    expect(() => exportBaselineArchive(storage, rows)).toThrow(BaselineArchiveError);
  });
});
