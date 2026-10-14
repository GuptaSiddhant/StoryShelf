import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { DesignModel } from "./design.ts";
import {
  figmaWithRender,
  PNG_BYTES,
  requested,
  respond,
  URL_FILE,
  URL_NODE,
  URL_NODE_B,
} from "./figma-fixtures.ts";
import { FigmaNodeModel } from "./figma.ts";

afterEach(() => vi.restoreAllMocks());

async function setup(withToken = true): Promise<{ design: DesignModel; nodes: FigmaNodeModel }> {
  const { db } = makeDatabase();
  const design = new DesignModel(db, undefined, "secret-0000000000");
  if (withToken) await design.setToken("p1", "tok");
  return { design, nodes: new FigmaNodeModel(db, design) };
}

describe("FigmaNodeModel", () => {
  it("fetches, caches within the TTL and refetches after it", async () => {
    const { nodes, design } = await setup();
    const spy = respond(200, { name: "Kit", version: "1", lastModified: "2026-01-01T00:00:00Z" });
    const t0 = new Date("2026-01-02T00:00:00Z");
    const first = await nodes.refresh("p1", URL_FILE, t0);
    expect(first).toMatchObject({ state: "ok", name: "Kit", nodeId: "" });
    await nodes.refresh("p1", URL_FILE, new Date(t0.getTime() + 60_000));
    expect(spy).toHaveBeenCalledTimes(1);
    const later = await nodes.refresh("p1", URL_FILE, new Date(t0.getTime() + 3_600_000));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(later?.id).toBe(first?.id);
    expect((await design.tokenInfo("p1"))?.status).toBe("ok");
    expect((await nodes.cachedFor("p1", [URL_FILE, "bad"])).get(URL_FILE)?.name).toBe("Kit");
  });

  it("keeps good cache through an outage and flags auth failures", async () => {
    const { nodes, design } = await setup();
    respond(200, { name: "Kit" });
    const t0 = new Date("2026-01-02T00:00:00Z");
    await nodes.refresh("p1", URL_FILE, t0);
    const later = new Date(t0.getTime() + 3_600_000);
    respond(400);
    expect((await nodes.refresh("p1", URL_FILE, later))?.state).toBe("ok");
    respond(401);
    expect((await nodes.refresh("p1", URL_FILE, later))?.state).toBe("unauthorized");
    expect((await design.tokenInfo("p1"))?.status).toBe("unauthorized");
  });

  it("returns the cache untouched without a token, and null for non-Figma urls", async () => {
    const { nodes } = await setup(false);
    const spy = respond(200);
    expect(await nodes.refresh("p1", URL_FILE)).toBeNull();
    expect(await nodes.refresh("p1", "https://example.com")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

async function renderSetup(): Promise<{ nodes: FigmaNodeModel; objects: Map<string, Buffer> }> {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const design = new DesignModel(db, undefined, "secret-0000000000");
  await design.setToken("p1", "tok");
  return { nodes: new FigmaNodeModel(db, design, { storage }), objects };
}

function imageCalls(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter(([request]) => String(request).includes("/images/")).length;
}

describe("FigmaNodeModel renders", () => {
  it("caches the render by file version and refetches only when it moves", async () => {
    const { nodes, objects } = await renderSetup();
    const spy = figmaWithRender("1");
    const t0 = new Date("2026-01-02T00:00:00Z");
    const first = await nodes.refresh("p1", URL_NODE, t0);
    expect(first).toMatchObject({ renderVersion: "1", renderPath: "p1/design/KEY/1-2.png" });
    expect(objects.get("p1/design/KEY/1-2.png")).toEqual(PNG_BYTES);
    expect(await nodes.readRender(first!)).toEqual(PNG_BYTES);

    const rendersBefore = imageCalls(spy);
    await nodes.refresh("p1", URL_NODE, new Date(t0.getTime() + 3_600_000));
    expect(imageCalls(spy)).toBe(rendersBefore);

    figmaWithRender("2");
    const moved = await nodes.refresh("p1", URL_NODE, new Date(t0.getTime() + 7_200_000));
    expect(moved?.renderVersion).toBe("2");
    expect((await nodes.get("p1", moved!.id))?.renderVersion).toBe("2");
    expect(await nodes.get("other", moved!.id)).toBeNull();
  });

  it("keeps the metadata and old render when the render download fails", async () => {
    const { nodes } = await renderSetup();
    figmaWithRender("1", { png: false });
    const node = await nodes.refresh("p1", URL_NODE, new Date("2026-01-02T00:00:00Z"));
    expect(node).toMatchObject({ state: "ok", renderPath: null, renderVersion: null });
    expect(await nodes.readRender(node!)).toBeNull();
  });

  it("does not render whole-file links or without storage", async () => {
    const { nodes, objects } = await renderSetup();
    figmaWithRender("1");
    await nodes.refresh("p1", URL_FILE);
    expect(objects.size).toBe(0);
    const plain = await setup();
    expect(await plain.nodes.readRender({ renderPath: "x" } as never)).toBeNull();
  });
});

describe("FigmaNodeModel batching and limits", () => {
  it("refreshes several nodes of one file with one metadata and one render request", async () => {
    const { nodes, objects } = await renderSetup();
    const spy = figmaWithRender("1");
    const results = await nodes.refreshMany("p1", [URL_NODE, URL_NODE_B, URL_FILE]);
    expect(results.get(URL_NODE)?.renderPath).toBe("p1/design/KEY/1-2.png");
    expect(results.get(URL_NODE_B)?.renderPath).toBe("p1/design/KEY/3-4.png");
    expect(results.get(URL_FILE)?.renderPath).toBeNull();
    expect(objects.size).toBe(2);
    const urls = spy.mock.calls.map(requested);
    expect(urls.filter((url) => url.includes("/nodes?"))).toHaveLength(1);
    expect(urls.filter((url) => url.includes("/images/"))).toHaveLength(1);
  });

  it("refreshes at most three files at a time", async () => {
    const { nodes } = await renderSetup();
    let inFlight = 0;
    let peak = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      inFlight -= 1;
      return Response.json({ name: "Kit", version: "1", lastModified: "2026-01-01T00:00:00Z" });
    });
    const urls = Array.from(
      { length: 9 },
      (_unused, i) => `https://www.figma.com/design/F${i}/Kit`,
    );
    const results = await nodes.refreshMany("p1", urls);
    expect(results.size).toBe(9);
    expect(peak).toBe(3);
  });
});

const later = (base: Date, ms: number): Date => new Date(base.getTime() + ms);

describe("FigmaNodeModel state transitions", () => {
  const t0 = new Date("2026-01-02T00:00:00Z");

  it("drops the cached render when the node is deleted, and keeps the label", async () => {
    const { nodes, objects } = await renderSetup();
    figmaWithRender("1");
    const first = await nodes.refresh("p1", URL_NODE, t0);
    expect(first?.renderPath).not.toBeNull();
    expect(objects.size).toBe(1);

    figmaWithRender("1", { nodes: { "1:2": null } });
    const gone = await nodes.refresh("p1", URL_NODE, later(t0, 3_600_000));
    expect(gone).toMatchObject({ state: "deleted", renderPath: null, renderVersion: null });
    expect(gone?.name).toBe("Button");
    expect(objects.size).toBe(0);
    expect(await nodes.readRender(gone!)).toBeNull();
  });

  it("keeps the last good name and render through an auth failure", async () => {
    const { nodes, objects } = await renderSetup();
    figmaWithRender("1");
    await nodes.refresh("p1", URL_NODE, t0);
    respond(403);
    const denied = await nodes.refresh("p1", URL_NODE, later(t0, 3_600_000));
    expect(denied).toMatchObject({ state: "forbidden", name: "Button", version: "1" });
    expect(denied?.renderPath).not.toBeNull();
    expect(objects.size).toBe(1);
  });
});
