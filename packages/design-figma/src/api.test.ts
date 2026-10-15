import type { DesignCallOptions, DesignMeta, DesignRef } from "@storyshelf/core/adapter/design";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFigmaMetas, fetchFigmaRenders } from "./api.ts";
import {
  figmaWithRender,
  PNG_BYTES,
  requested,
  respond,
  URL_FILE,
  URL_NODE,
  URL_NODE_B,
} from "./fixtures.ts";
import { parseFigmaUrl } from "./url.ts";

afterEach(() => vi.restoreAllMocks());

/** Metadata of one ref, through the batched client. */
async function fetchFigmaMeta(
  token: string,
  ref: DesignRef,
  options: DesignCallOptions = {},
): Promise<DesignMeta> {
  const metas = await fetchFigmaMetas(token, ref.fileKey, [ref], options);
  return (
    metas.get(ref.nodeId ?? "") ?? { state: "error", name: null, version: null, lastModified: null }
  );
}

/** Render of one node; null for whole-file refs and nodes Figma cannot render. */
async function fetchFigmaRender(token: string, ref: DesignRef) {
  if (!ref.nodeId) return null;
  return (await fetchFigmaRenders(token, ref.fileKey, [ref.nodeId])).get(ref.nodeId) ?? null;
}

describe("fetchFigmaMeta", () => {
  const node = parseFigmaUrl(URL_NODE)!;
  const file = parseFigmaUrl(URL_FILE)!;

  it("reads node metadata with the token header", async () => {
    const spy = respond(200, {
      name: "Kit",
      version: "7",
      lastModified: "2026-01-01T00:00:00Z",
      nodes: { "1:2": { document: { name: "Button" } } },
    });
    await expect(fetchFigmaMeta("tok", node)).resolves.toEqual({
      state: "ok",
      name: "Button",
      version: "7",
      lastModified: "2026-01-01T00:00:00Z",
    });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/files/KEY/nodes?ids=1%3A2");
    expect(new Headers(init.headers).get("x-figma-token")).toBe("tok");
  });

  it("reads file metadata", async () => {
    respond(200, { name: "Kit", version: "1", lastModified: "2026-01-01T00:00:00Z" });
    expect((await fetchFigmaMeta("t", file)).name).toBe("Kit");
  });

  it("reports a null node as deleted and keeps file name fallback", async () => {
    respond(200, { name: "Kit", nodes: { "1:2": null } });
    expect((await fetchFigmaMeta("t", node)).state).toBe("deleted");
    respond(200, { name: "Kit", nodes: { "1:2": { document: {} } } });
    expect((await fetchFigmaMeta("t", node)).name).toBe("Kit");
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "deleted"],
    [400, "error"],
  ])("maps HTTP %i to %s", async (status, state) => {
    respond(status, { err: "x" });
    expect((await fetchFigmaMeta("t", file)).state).toBe(state);
  });

  it("maps network failures to error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    expect((await fetchFigmaMeta("t", file)).state).toBe("error");
  });
});

describe("fetchFigmaRender", () => {
  it("downloads the rendered bytes and skips whole-file links", async () => {
    figmaWithRender("1");
    expect([...((await fetchFigmaRender("t", parseFigmaUrl(URL_NODE)!)) ?? [])]).toEqual([
      ...PNG_BYTES,
    ]);
    expect(await fetchFigmaRender("t", parseFigmaUrl(URL_FILE)!)).toBeNull();
  });

  it("returns null when Figma has no render", async () => {
    figmaWithRender("1", { images: { images: { "1:2": null } } });
    expect(await fetchFigmaRender("t", parseFigmaUrl(URL_NODE)!)).toBeNull();
  });
});

describe("batched fetches", () => {
  const nodeA = parseFigmaUrl(URL_NODE)!;
  const nodeB = parseFigmaUrl(URL_NODE_B)!;
  const file = parseFigmaUrl(URL_FILE)!;

  it("reads every node of a file with one nodes request (plus one for the whole file)", async () => {
    const spy = figmaWithRender("5");
    const metas = await fetchFigmaMetas("t", "KEY", [nodeA, nodeB, file]);
    expect(metas.get("1:2")?.name).toBe("Button");
    expect(metas.get("3:4")?.name).toBe("Card");
    expect(metas.get("")?.state).toBe("ok");
    const urls = spy.mock.calls.map(requested);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("ids=1%3A2%2C3%3A4");
  });

  it("marks a missing node deleted and fails every ref together on an auth error", async () => {
    figmaWithRender("5", { nodes: { "1:2": { document: { name: "Button" } } } });
    const partial = await fetchFigmaMetas("t", "KEY", [nodeA, nodeB]);
    expect(partial.get("3:4")?.state).toBe("deleted");
    respond(401);
    const failed = await fetchFigmaMetas("t", "KEY", [nodeA, nodeB]);
    expect([...failed.values()].map((meta) => meta.state)).toEqual([
      "unauthorized",
      "unauthorized",
    ]);
  });

  it("renders several nodes with one Images request", async () => {
    const spy = figmaWithRender("5");
    const renders = await fetchFigmaRenders("t", "KEY", ["1:2", "3:4"]);
    expect([...renders.keys()]).toEqual(["1:2", "3:4"]);
    expect(spy.mock.calls.map(requested).filter((url) => url.includes("/images/"))).toHaveLength(1);
    expect(await fetchFigmaRenders("t", "KEY", [])).toEqual(new Map());
  });

  it("stops retrying once its signal aborts", async () => {
    const spy = respond(503);
    const controller = new AbortController();
    controller.abort();
    const meta = await fetchFigmaMeta("t", nodeA, { signal: controller.signal });
    expect(meta.state).toBe("error");
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
