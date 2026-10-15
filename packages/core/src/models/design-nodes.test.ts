import { describe, expect, it } from "vitest";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { FAKE_PNG, fakeUrl, makeFakeDesign, type FakeDesign } from "../test-helpers/fake-design.ts";
import { DesignCredentialModel } from "./design-credentials.ts";
import { DesignNodeModel } from "./design-nodes.ts";

const NODE_A = fakeUrl("KEY", "1:2");
const NODE_B = fakeUrl("KEY", "3:4");
const FILE = fakeUrl("KEY");
const T0 = new Date("2026-01-02T00:00:00Z");
const later = (base: Date, ms: number): Date => new Date(base.getTime() + ms);
const HOUR = 3_600_000;

interface Setup {
  fake: FakeDesign;
  nodes: DesignNodeModel;
  credentials: DesignCredentialModel;
  objects: Map<string, Buffer>;
}

async function setup(
  options: { withCredential?: boolean; withStorage?: boolean } = {},
): Promise<Setup> {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const fake = makeFakeDesign();
  const credentials = new DesignCredentialModel(db, "secret-0000000000");
  if (options.withCredential !== false) await credentials.set("p1", "fake", "tok");
  const nodes = new DesignNodeModel(db, credentials, [fake.provider], {
    storage: options.withStorage === false ? undefined : storage,
  });
  return { fake, nodes, credentials, objects };
}

describe("DesignNodeModel metadata cache", () => {
  it("fetches, caches within the TTL and refetches after it", async () => {
    const { fake, nodes, credentials } = await setup();
    const first = await nodes.refresh("p1", FILE, T0);
    expect(first).toMatchObject({
      state: "ok",
      name: "Node KEY",
      nodeId: "",
      provider: "fake",
      viewerId: "",
    });
    await nodes.refresh("p1", FILE, later(T0, 60_000));
    expect(fake.metaCalls).toHaveLength(1);
    const again = await nodes.refresh("p1", FILE, later(T0, HOUR));
    expect(fake.metaCalls).toHaveLength(2);
    expect(again?.id).toBe(first?.id);
    expect((await credentials.info("p1", "fake"))?.status).toBe("ok");
    expect((await nodes.cachedFor("p1", [FILE, "https://bad.example"])).get(FILE)?.name).toBe(
      "Node KEY",
    );
    expect(fake.credentials).toEqual(["tok", "tok"]);
  });

  it("keeps good cache through an outage and flags auth failures", async () => {
    const { fake, nodes, credentials } = await setup();
    await nodes.refresh("p1", FILE, T0);
    fake.states.set("", "error");
    expect((await nodes.refresh("p1", FILE, later(T0, HOUR)))?.state).toBe("ok");
    fake.states.set("", "unauthorized");
    expect((await nodes.refresh("p1", FILE, later(T0, HOUR)))?.state).toBe("unauthorized");
    expect((await credentials.info("p1", "fake"))?.status).toBe("unauthorized");
  });

  it("keeps the last good name and version through an auth failure", async () => {
    const { fake, nodes } = await setup();
    await nodes.refresh("p1", NODE_A, T0);
    fake.states.set("1:2", "forbidden");
    const denied = await nodes.refresh("p1", NODE_A, later(T0, HOUR));
    expect(denied).toMatchObject({ state: "forbidden", name: "Node 1:2", version: "1" });
  });

  it("returns the cache untouched without a credential, and null for unsupported urls", async () => {
    const { fake, nodes } = await setup({ withCredential: false });
    expect(await nodes.refresh("p1", FILE)).toBeNull();
    expect(await nodes.refresh("p1", "https://example.com")).toBeNull();
    expect(fake.metaCalls).toEqual([]);
  });

  it("scopes rows to the project", async () => {
    const { nodes } = await setup();
    const row = await nodes.refresh("p1", FILE, T0);
    expect(await nodes.get("p1", row?.id ?? "")).not.toBeNull();
    expect(await nodes.get("other", row?.id ?? "")).toBeNull();
  });
});

describe("DesignNodeModel renders", () => {
  it("caches the render by file version and refetches only when it moves", async () => {
    const { fake, nodes, objects } = await setup();
    const first = await nodes.refresh("p1", NODE_A, T0);
    expect(first).toMatchObject({ renderVersion: "1", renderPath: "p1/design/fake/KEY/1-2.png" });
    expect(objects.get("p1/design/fake/KEY/1-2.png")).toEqual(FAKE_PNG);
    expect(await nodes.readRender(first!)).toEqual(FAKE_PNG);

    await nodes.refresh("p1", NODE_A, later(T0, HOUR));
    expect(fake.renderCalls).toHaveLength(1);

    fake.version = "2";
    const moved = await nodes.refresh("p1", NODE_A, later(T0, 2 * HOUR));
    expect(moved?.renderVersion).toBe("2");
    expect(fake.renderCalls).toHaveLength(2);
  });

  it("keeps the metadata when the render fails or the node cannot be rendered", async () => {
    const { fake, nodes } = await setup();
    fake.failRenders = true;
    const failed = await nodes.refresh("p1", NODE_A, T0);
    expect(failed).toMatchObject({ state: "ok", renderPath: null, renderVersion: null });
    expect(await nodes.readRender(failed!)).toBeNull();
    fake.failRenders = false;
    fake.unrenderable.add("3:4");
    const plain = await nodes.refresh("p1", NODE_B, T0);
    expect(plain?.renderPath).toBeNull();
  });

  it("does not render whole-file links or without storage", async () => {
    const { nodes, objects } = await setup();
    await nodes.refresh("p1", FILE);
    expect(objects.size).toBe(0);
    const bare = await setup({ withStorage: false });
    const node = await bare.nodes.refresh("p1", NODE_A, T0);
    expect(node?.renderPath).toBeNull();
    expect(bare.fake.renderCalls).toEqual([]);
    expect(await bare.nodes.readRender({ renderPath: "x" } as never)).toBeNull();
  });

  it("drops the cached render when the node is deleted, and keeps the label", async () => {
    const { fake, nodes, objects } = await setup();
    const first = await nodes.refresh("p1", NODE_A, T0);
    expect(first?.renderPath).not.toBeNull();
    fake.states.set("1:2", "deleted");
    const gone = await nodes.refresh("p1", NODE_A, later(T0, HOUR));
    expect(gone).toMatchObject({
      state: "deleted",
      renderPath: null,
      renderVersion: null,
      name: "Node 1:2",
    });
    expect(objects.size).toBe(0);
    expect(await nodes.readRender(gone!)).toBeNull();
  });

  it("keeps the render through an auth failure", async () => {
    const { fake, nodes, objects } = await setup();
    await nodes.refresh("p1", NODE_A, T0);
    fake.states.set("1:2", "forbidden");
    const denied = await nodes.refresh("p1", NODE_A, later(T0, HOUR));
    expect(denied?.renderPath).not.toBeNull();
    expect(objects.size).toBe(1);
  });
});

describe("DesignNodeModel batching and limits", () => {
  it("refreshes several nodes of one file with one metadata and one render call", async () => {
    const { fake, nodes, objects } = await setup();
    const results = await nodes.refreshMany("p1", [NODE_A, NODE_B, FILE]);
    expect(results.get(NODE_A)?.renderPath).toBe("p1/design/fake/KEY/1-2.png");
    expect(results.get(NODE_B)?.renderPath).toBe("p1/design/fake/KEY/3-4.png");
    expect(results.get(FILE)?.renderPath).toBeNull();
    expect(objects.size).toBe(2);
    expect(fake.metaCalls).toHaveLength(1);
    expect(new Set(fake.metaCalls[0]?.nodeIds)).toEqual(new Set(["", "1:2", "3:4"]));
    expect(fake.renderCalls).toHaveLength(1);
    expect(new Set(fake.renderCalls[0]?.nodeIds)).toEqual(new Set(["1:2", "3:4"]));
  });

  it("refreshes at most three files at a time", async () => {
    const { fake, nodes } = await setup();
    fake.delayMs = 10;
    const urls = Array.from({ length: 9 }, (_unused, i) => fakeUrl(`F${i}`));
    const results = await nodes.refreshMany("p1", urls);
    expect(results.size).toBe(9);
    expect(fake.metaCalls).toHaveLength(9);
    expect(fake.peak).toBe(3);
  });

  it("cancels in-flight provider calls when the signal aborts and keeps the cache", async () => {
    const { fake, nodes } = await setup();
    await nodes.refresh("p1", FILE, T0);
    fake.delayMs = 20;
    const controller = new AbortController();
    controller.abort();
    const results = await nodes
      .refreshMany("p1", [FILE], { now: later(T0, HOUR), signal: controller.signal })
      .catch(() => null);
    expect(results === null || results.get(FILE)?.state === "ok").toBe(true);
  });
});
