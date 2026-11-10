import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BuildReferenceLifecycle } from "../adapters/database.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { BaselineModel } from "./baseline.ts";

const emit = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => await Promise.resolve()));
vi.mock("../adapters/webhook-events.ts", () => ({ emitWebhookEvent: emit }));

const PNG = Buffer.from([137, 80, 78, 71]);
const SECRET = "server-secret";

/** A lifecycle that runs the write against the same database, without any fencing. */
function passThroughLifecycle(db: ReturnType<typeof makeDatabase>["db"]): BuildReferenceLifecycle {
  return {
    referenceGeneration: async () => await Promise.resolve(0),
    replaceManyFencedReferences: async (changes, writeDomain) => ({
      result: await writeDomain(db),
      generations: changes.map((change) => change.expectedGeneration + 1),
    }),
    replaceFencedReferences: async (_owner, generation, _ids, writeDomain) => ({
      result: await writeDomain(db),
      generation: generation + 1,
    }),
    claimDeletion: async () => "missing",
    listDeleting: async () => [],
    releaseBuildContent: async () => "not-deleting",
    markStorageDeleted: async () => "not-deleting",
    completeDeletion: async () => "not-deleting",
    recordContentUses: async () => [],
    claimContent: async () => [],
    holdsContentClaim: async () => false,
    abandonContentClaim: async () => {},
    finishContentCollection: async () => {},
  };
}

async function modelWith(options: { fenced: boolean; webhooks: boolean }) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  if (options.fenced) {
    (db as { buildReferenceLifecycle?: BuildReferenceLifecycle }).buildReferenceLifecycle =
      passThroughLifecycle(db);
  }
  await storage.write("source/shot.png", PNG);
  const webhookTables = options.webhooks ? ({ webhooks: {} } as never) : undefined;
  const model = new BaselineModel(
    db,
    { baselines: db.tables.baselines },
    storage,
    SECRET,
    webhookTables,
  );
  return { db, model, webhookTables };
}

const upsert = async (
  model: BaselineModel,
  snapshotId: string,
  extra: Parameters<BaselineModel["upsert"]>[7] = {},
  infraHash?: string,
) =>
  await model.upsert(
    "p1",
    "story-a",
    "desktop",
    "main",
    snapshotId,
    "source/shot.png",
    infraHash,
    extra,
  );

beforeEach(() => {
  emit.mockClear();
});

describe.each([
  ["without the lifecycle capability", false],
  ["with the lifecycle capability", true],
])("BaselineModel.upsert webhooks %s", (_label, fenced) => {
  it("announces a created baseline, then an updated one, with the story's identity", async () => {
    const { db, model, webhookTables } = await modelWith({ fenced, webhooks: true });
    const created = await upsert(model, "snap-1");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenLastCalledWith(
      db,
      webhookTables,
      "p1",
      "baseline:created",
      {
        baselineId: created.id,
        storyId: "story-a",
        viewport: "desktop",
        browser: "chromium",
        mode: null,
        branch: "main",
        snapshotId: "snap-1",
      },
      SECRET,
    );
    const updated = await upsert(model, "snap-2", { browser: "chromium", mode: '{"dark":true}' });
    expect(updated.id).toBe(created.id);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(
      db,
      webhookTables,
      "p1",
      "baseline:updated",
      {
        baselineId: created.id,
        storyId: "story-a",
        viewport: "desktop",
        browser: "chromium",
        mode: '{"dark":true}',
        branch: "main",
        snapshotId: "snap-2",
      },
      SECRET,
    );
  });

  it("announces nothing when the model has no webhook tables", async () => {
    const { model } = await modelWith({ fenced, webhooks: false });
    await upsert(model, "snap-1");
    await upsert(model, "snap-2");
    expect(emit).not.toHaveBeenCalled();
  });

  it("announces a baseline per engine as created, not updated", async () => {
    const { model } = await modelWith({ fenced, webhooks: true });
    await upsert(model, "snap-1");
    await upsert(model, "snap-1", { browser: "firefox" });
    expect(emit.mock.calls.map((call) => call[3])).toEqual([
      "baseline:created",
      "baseline:created",
    ]);
  });
});

describe("BaselineModel.upsert without the lifecycle capability", () => {
  it("keeps the fingerprint data of the baseline it updates when the new write has none", async () => {
    const { model } = await modelWith({ fenced: false, webhooks: false });
    const first = await upsert(
      model,
      "snap-1",
      { fingerprint: '{"os":"linux"}', mode: "dark" },
      "hash-1",
    );
    expect(first).toMatchObject({
      infraHash: "hash-1",
      fingerprint: '{"os":"linux"}',
      mode: "dark",
    });
    const second = await upsert(model, "snap-2");
    expect(second).toMatchObject({
      id: first.id,
      snapshotId: "snap-2",
      infraHash: "hash-1",
      fingerprint: '{"os":"linux"}',
      mode: "dark",
    });
  });

  it("stores empty fingerprint data as null on a first write", async () => {
    const { model } = await modelWith({ fenced: false, webhooks: false });
    expect(await upsert(model, "snap-1")).toMatchObject({
      infraHash: null,
      fingerprint: null,
      mode: null,
    });
  });
});

describe("BaselineModel without a storage adapter", () => {
  it("still resolves baselines, and says what is missing when asked to read a file", async () => {
    const { db } = makeDatabase();
    const model = new BaselineModel(db);
    await expect(model.getFor("p1", "story-a", "desktop", "main")).resolves.toBeNull();
    await expect(
      model.read({ screenshotPath: "p1/shot.png" } as Parameters<BaselineModel["read"]>[0]),
    ).rejects.toThrow("without a storage adapter");
  });
});
