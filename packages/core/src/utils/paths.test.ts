import { describe, expect, it } from "vitest";
import {
  baselinePath,
  contentKey,
  diffPath,
  isContentHash,
  modeSegment,
  publishedGzipPath,
  screenshotPath,
} from "./paths.ts";

describe("storage path builders", () => {
  it("builds screenshot paths", () => {
    expect(screenshotPath("p1", "b1", "story", "desktop")).toBe(
      "p1/builds/b1/screenshots/story/desktop.png",
    );
  });

  it("rejects traversal segments", () => {
    expect(() => screenshotPath("p1", "b1", "../../x", "desktop")).toThrow("Unsafe");
    expect(() => screenshotPath("p1", "b1", "..", "desktop")).toThrow("Unsafe");
    expect(() => baselinePath("", "main", "a", "desktop")).toThrow("Unsafe");
  });

  it("allows slashes inside branch names", () => {
    expect(baselinePath("p1", "feature/foo", "a", "desktop")).toBe(
      "p1/baselines/feature/foo/a/desktop.png",
    );
  });
});

describe("browser-aware paths", () => {
  it("keeps chromium paths legacy-compatible and suffixes other engines", () => {
    expect(modeSegment("dark")).toBe("dark");
    expect(modeSegment("dark", "chromium")).toBe("dark");
    expect(modeSegment("dark", "firefox")).toBe("dark~firefox");
    expect(screenshotPath("p", "b", "s", "dark", "webkit")).toBe(
      "p/builds/b/screenshots/s/dark~webkit.png",
    );
    expect(diffPath("p", "b", "s", "dark", "firefox")).toBe("p/builds/b/diffs/s/dark~firefox.png");
    expect(baselinePath("p", "main", "s", "dark")).toBe("p/baselines/main/s/dark.png");
    expect(() => baselinePath("p", "main", "s", "dark", "../x")).toThrow(/Unsafe/u);
  });

  it("gives a remote target its own path: the full `<engine>@<name>` is the suffix", () => {
    expect(modeSegment("dark", "chromium@grid")).toBe("dark~chromium@grid");
    expect(screenshotPath("p", "b", "s", "dark", "chromium@grid")).toBe(
      "p/builds/b/screenshots/s/dark~chromium@grid.png",
    );
    expect(diffPath("p", "b", "s", "dark", "webkit@bs-mac")).toBe(
      "p/builds/b/diffs/s/dark~webkit@bs-mac.png",
    );
    expect(baselinePath("p", "main", "s", "dark", "chromium@grid")).toBe(
      "p/baselines/main/s/dark~chromium@grid.png",
    );
  });
});

describe("contentKey", () => {
  const hash = "0123456789abcdef".repeat(4);

  it("builds the shared content key of a SHA-256 hex digest", () => {
    expect(isContentHash(hash)).toBe(true);
    expect(contentKey(hash)).toBe(`content/${hash}`);
    expect(publishedGzipPath(hash)).toBe(`derived/published-gzip/${hash}.gz`);
  });

  it.each([
    "..",
    "../p1/builds/b1/storybook/index.html",
    `${hash.slice(0, 32)}/${hash.slice(33)}`,
    hash.toUpperCase(),
    hash.slice(1),
    `${hash}0`,
    `${hash}\n`,
    "",
  ])("refuses %j without echoing it", (bad) => {
    expect(isContentHash(bad)).toBe(false);
    // The whole message is fixed text: the refused value is not part of it.
    expect(() => contentKey(bad)).toThrow(/^Invalid content hash$/u);
  });
});
