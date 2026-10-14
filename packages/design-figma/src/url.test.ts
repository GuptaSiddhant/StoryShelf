import { describe, expect, it } from "vitest";
import { parseFigmaUrl } from "./url.ts";

describe("parseFigmaUrl", () => {
  it("parses file, design, board and proto links", () => {
    for (const kind of ["file", "design", "board", "proto"]) {
      expect(parseFigmaUrl(`https://www.figma.com/${kind}/Key123/Name`)?.fileKey).toBe("Key123");
    }
  });

  it("normalizes the node id", () => {
    expect(parseFigmaUrl("https://figma.com/design/K/N?node-id=12-34")?.nodeId).toBe("12:34");
    expect(parseFigmaUrl("https://figma.com/design/K/N?node-id=12%3A34")?.nodeId).toBe("12:34");
    expect(parseFigmaUrl("https://figma.com/design/K/N")?.nodeId).toBeNull();
  });

  it("converts every hyphen, validates the node id, and strips credentials and fragments", () => {
    expect(parseFigmaUrl("https://figma.com/design/K/N?node-id=1-2-3")).toBeNull();
    expect(parseFigmaUrl("https://figma.com/design/K/N?node-id=abc")).toBeNull();
    expect(parseFigmaUrl("https://figma.com/design/K/N?node-id=12-34")?.nodeId).toBe("12:34");
    const clean = parseFigmaUrl("https://user:pw@figma.com/design/K/N?node-id=1-2#frag");
    expect(clean?.url).toBe("https://figma.com/design/K/N?node-id=1-2");
  });

  it("rejects other hosts, schemes, paths and garbage", () => {
    expect(parseFigmaUrl("https://evil.com/design/K/N")).toBeNull();
    expect(parseFigmaUrl("https://figma.com.evil.com/design/K/N")).toBeNull();
    expect(parseFigmaUrl("http://figma.com/design/K/N")).toBeNull();
    expect(parseFigmaUrl("https://figma.com/community/x")).toBeNull();
    expect(parseFigmaUrl("https://figma.com/embed?url=x")).toBeNull();
    expect(parseFigmaUrl("https://kit.figma.site/")).toBeNull();
    expect(parseFigmaUrl("not a url")).toBeNull();
  });
});
