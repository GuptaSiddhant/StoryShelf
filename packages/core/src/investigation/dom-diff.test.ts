import { describe, expect, it } from "vitest";
import { compareReplayDom, type ReplayDom, type ReplayNode } from "./dom-diff.ts";

const node = (path: string, id?: string): ReplayNode => ({
  path,
  tag: "div",
  ...(id ? { id } : {}),
  attributes: {},
  style: {},
  bounds: null,
});
const dom = (nodes: ReplayNode[], truncated = false): ReplayDom => ({
  nodes,
  truncated,
  fingerprint: null,
});

describe("replay DOM observations", () => {
  it("reports measured attribute, style and bound changes for a unique ID", () => {
    const before = {
      ...node("0/1", "panel"),
      attributes: { role: "list" },
      style: { color: "red" },
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    };
    const after = {
      ...node("0/2", "panel"),
      attributes: { role: "grid" },
      style: { color: "blue" },
      bounds: { x: 1, y: 0, width: 10, height: 10 },
    };
    expect(compareReplayDom(dom([before]), dom([after]))).toMatchObject({
      matched: 1,
      unmatchedBefore: 0,
      unmatchedAfter: 0,
      observations: [
        { kind: "attribute", name: "role", before: "list", after: "grid" },
        { kind: "style", name: "color", before: "red", after: "blue" },
        { kind: "bounds" },
      ],
    });
  });
  it("leaves duplicate IDs unmatched and reports truncation", () => {
    const result = compareReplayDom(
      dom([node("0/1", "duplicate"), node("0/2", "duplicate")], true),
      dom([node("0/1", "duplicate")]),
    );
    expect(result).toMatchObject({
      matched: 0,
      unmatchedBefore: 2,
      unmatchedAfter: 1,
      partial: true,
    });
  });
  it("matches unchanged structural paths without IDs", () => {
    expect(compareReplayDom(dom([node("0/1")]), dom([node("0/1")]))).toMatchObject({
      matched: 1,
      observations: [],
    });
  });
});
