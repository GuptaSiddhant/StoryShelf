import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { parseFigmaUrl } from "../utils/figma-url.ts";
import { DesignModel } from "./design.ts";
import {
  fetchFigmaMeta,
  fetchFigmaRender,
  FigmaNodeModel,
  isDesignStale,
  tokenDaysLeft,
} from "./figma.ts";

const URL_NODE = "https://www.figma.com/design/KEY/Kit?node-id=1-2";
const URL_FILE = "https://www.figma.com/design/KEY/Kit";

afterEach(() => vi.restoreAllMocks());

function respond(status: number, body: unknown = {}): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response(JSON.stringify(body), { status }));
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

describe("isDesignStale / tokenDaysLeft", () => {
  const node = { state: "ok", lastModified: "2026-02-01T00:00:00Z" };
  it("is stale only when the design moved after approval", () => {
    expect(isDesignStale(node, "2026-01-01T00:00:00Z")).toBe(true);
    expect(isDesignStale(node, "2026-03-01T00:00:00Z")).toBe(false);
    expect(isDesignStale(node, "no-baseline")).toBe(false);
    expect(isDesignStale(node, null)).toBe(false);
    expect(isDesignStale(null, "2026-01-01T00:00:00Z")).toBe(false);
    expect(
      isDesignStale({ state: "deleted", lastModified: node.lastModified }, "2026-01-01T00:00:00Z"),
    ).toBe(false);
    expect(isDesignStale({ state: "ok", lastModified: null }, "2026-01-01T00:00:00Z")).toBe(false);
  });

  it("counts days left of the 90-day cap", () => {
    const now = new Date("2026-04-01T00:00:00Z");
    expect(tokenDaysLeft("2026-04-01T00:00:00Z", now)).toBe(90);
    expect(tokenDaysLeft("2025-12-31T00:00:00Z", now)).toBe(-1);
  });
});

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

const PNG_BYTES = Buffer.from([137, 80, 78, 71]);

function figmaWithRender(
  version: string,
  opts: { images?: unknown; png?: boolean } = {},
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/images/")) {
      return Response.json(opts.images ?? { images: { "1:2": "https://cdn.example.com/r.png" } });
    }
    if (url.startsWith("https://cdn.example.com/")) {
      return opts.png === false ? new Response("x", { status: 404 }) : new Response(PNG_BYTES);
    }
    return Response.json({
      name: "Kit",
      version,
      lastModified: "2026-01-01T00:00:00Z",
      nodes: { "1:2": { document: { name: "Button" } } },
    });
  });
}

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
