import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertSameBytes, parseRecorded, type RecordedChecksums } from "./htmx-checksums.ts";

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);

function record(version = "1.9.12", sha256 = OLD): RecordedChecksums {
  return {
    version,
    upstream: { package: `htmx.org@${version}`, file: "dist/htmx.min.js", sha256, bytes: 10 },
    embedded: { sha256: OLD, bytes: 12 },
  };
}

describe("parseRecorded", () => {
  it("reads nothing as no record yet", () => {
    expect(parseRecorded()).toBeUndefined();
  });

  it("reads a valid record, and the committed one", () => {
    expect(parseRecorded(JSON.stringify(record()))).toEqual(record());
    const committed = readFileSync(new URL("htmx.sha256.json", import.meta.url), "utf8");
    expect(parseRecorded(committed)?.version).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("refuses a damaged record instead of reading it as absent", () => {
    expect(() => parseRecorded("{not json")).toThrow();
    expect(() => parseRecorded("")).toThrow();
    expect(() => parseRecorded("null")).toThrow(/not a valid checksum record/u);
    const versionOnly = JSON.stringify({ version: "1.9.12" });
    expect(() => parseRecorded(versionOnly)).toThrow(/not a valid checksum record/u);
    const shortSha = JSON.stringify({ ...record(), upstream: { sha256: "short", bytes: 1 } });
    expect(() => parseRecorded(shortSha)).toThrow(/not a valid checksum record/u);
  });
});

describe("assertSameBytes", () => {
  it("accepts a first run, a new version and identical bytes", () => {
    expect(() => {
      assertSameBytes(undefined, "1.9.12", NEW, false);
      assertSameBytes(record("1.9.11"), "1.9.12", NEW, false);
      assertSameBytes(record(), "1.9.12", OLD, false);
    }).not.toThrow();
  });

  it("refuses other bytes for the recorded version, unless accepted", () => {
    expect(() => {
      assertSameBytes(record(), "1.9.12", NEW, false);
    }).toThrow(/--accept-changed-checksum/u);
    expect(() => {
      assertSameBytes(record(), "1.9.12", NEW, true);
    }).not.toThrow();
  });
});
