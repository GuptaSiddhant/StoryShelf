import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { zipStream } from "../utils/zip-write.ts";
import { BaselineArchiveError, type BaselineManifestEntry } from "./baseline-archive.ts";
import { planBaselineImport } from "./baseline-import.ts";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("img"),
]);
const NOW = "2026-01-01T00:00:00.000Z";

function entry(overrides: Partial<BaselineManifestEntry> = {}): BaselineManifestEntry {
  return {
    storyId: "button--primary",
    viewport: "desktop",
    browser: "chromium",
    branch: "main",
    mode: null,
    infraHash: null,
    createdAt: NOW,
    updatedAt: NOW,
    file: "baselines/main/button--primary/desktop.png",
    sha256: createHash("sha256").update(PNG).digest("hex"),
    ...overrides,
  };
}

function manifest(baselines: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: "storyshelf-baselines",
    version: 1,
    exportedAt: NOW,
    project: null,
    branch: null,
    baselines,
    ...extra,
  });
}

async function archive(files: Record<string, Buffer | string>): Promise<Buffer> {
  const parts: Buffer[] = [];
  const sources = Object.entries(files).map(([name, data]) => ({
    name,
    data: async () => Buffer.from(data),
  }));
  for await (const chunk of zipStream(sources)) {
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

const IMAGE = { "baselines/main/button--primary/desktop.png": PNG };

describe("planBaselineImport", () => {
  it("plans content-addressed storage paths, not the zip entry name", async () => {
    const plan = await planBaselineImport(
      await archive({
        "manifest.json": manifest([entry({ file: "anything/at/all.png" })]),
        "anything/at/all.png": PNG,
      }),
      "p9",
    );
    expect(plan.map((item) => item.storagePath)).toEqual([
      `p9/content/${createHash("sha256").update(PNG).digest("hex")}.png`,
    ]);
  });

  it.each([
    ["not a zip", Buffer.from("plain text"), /Not a zip/u],
    ["no manifest", { ...IMAGE }, /no manifest\.json/u],
    ["invalid JSON", { "manifest.json": "{", ...IMAGE }, /not valid JSON/u],
    [
      "a foreign format",
      { "manifest.json": manifest([], { format: "chromatic" }), ...IMAGE },
      /format/u,
    ],
    ["a future version", { "manifest.json": manifest([], { version: 2 }), ...IMAGE }, /version/u],
    [
      "a bad checksum",
      { "manifest.json": manifest([entry({ sha256: "0".repeat(64) })]), ...IMAGE },
      /checksum/u,
    ],
    [
      "a missing image",
      { "manifest.json": manifest([entry({ file: "nope.png" })]), ...IMAGE },
      /missing nope\.png/u,
    ],
    [
      "the manifest as image",
      { "manifest.json": manifest([entry({ file: "manifest.json" })]) },
      /missing manifest\.json/u,
    ],
    [
      "a non-PNG image",
      {
        "manifest.json": manifest([entry()]),
        "baselines/main/button--primary/desktop.png": "GIF89a",
      },
      /not a PNG/u,
    ],
    [
      "a duplicate identity",
      { "manifest.json": manifest([entry(), entry()]), ...IMAGE },
      /Duplicate baseline/u,
    ],
    [
      "a file shared by two baselines",
      { "manifest.json": manifest([entry(), entry({ viewport: "mobile" })]), ...IMAGE },
      /Duplicate baseline or file/u,
    ],
    [
      "a traversing story id",
      { "manifest.json": manifest([entry({ storyId: "../../etc" })]), ...IMAGE },
      /Unsafe baseline identity/u,
    ],
    [
      "a traversing branch",
      { "manifest.json": manifest([entry({ branch: "../other-project" })]), ...IMAGE },
      /Unsafe baseline identity/u,
    ],
    [
      "a traversing entry name",
      { "manifest.json": manifest([]), "../escape.png": PNG },
      /Unsafe zip entry/u,
    ],
    [
      "a bad timestamp",
      { "manifest.json": manifest([entry({ createdAt: "yesterday" })]), ...IMAGE },
      /createdAt/u,
    ],
  ])("rejects %s", async (_label, input, message) => {
    const zip = Buffer.isBuffer(input) ? input : await archive(input);
    await expect(planBaselineImport(zip, "p1")).rejects.toThrow(BaselineArchiveError);
    await expect(planBaselineImport(zip, "p1")).rejects.toThrow(message);
  });

  it("accepts an empty manifest", async () => {
    expect(
      await planBaselineImport(await archive({ "manifest.json": manifest([]) }), "p1"),
    ).toEqual([]);
  });
});
