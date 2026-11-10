import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import {
  DesignCredentialModel,
  DesignNodeModel,
  MemberModel,
  NotificationSubscriptionModel,
} from "@storyshelf/core/models";
import type { DesignNode } from "@storyshelf/core/schema";
import { fakeUrl, makeDatabase, makeFakeDesign, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  announceDesignChangesWith,
  DESIGN_CHANGED_EVENT,
  type DesignObservation,
} from "./design-events.ts";
import type { NotifyDeps } from "./notify.ts";

const webhooks = vi.hoisted(() => ({ emitted: [] as unknown[][] }));
vi.mock("@storyshelf/core/adapter/webhook-events", () => ({
  // oxlint-disable-next-line eslint/require-await -- the real emitter is async
  emitWebhookEvent: async (...args: unknown[]) => {
    webhooks.emitted.push(args);
  },
}));

const URL_A = fakeUrl("KEY", "1:2");
const PROJECT = { id: "p1", slug: "shop" };
const COMPONENT = "src/Button.stories.tsx";
const APPROVED = "2026-01-01T00:00:00.000Z";
const SECRET = "test-server-secret-32-chars-long!!";

beforeEach(() => {
  webhooks.emitted.length = 0;
});

function recorder(kind: string, sent: unknown[]): NotifierProvider {
  const metadata = {
    name: kind,
    version: "0.0.0",
    kind,
    category: "notifier" as const,
    audience: (kind === "email" ? "person" : "room") as "person" | "room",
    schema: {} as never,
  };
  return {
    metadata,
    create: () => ({
      metadata,
      // oxlint-disable-next-line eslint/require-await -- send is async by contract
      send: async (input: unknown) => {
        sent.push(input);
      },
    }),
  };
}

async function setup(publicBaseUrl: string | null = "https://shelf.example.com") {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, { id: "p1", name: "Shop", slug: "shop" } as never);
  await Promise.all(
    ["subscriber", "bystander"].map(
      async (id) =>
        await db.insert(db.tables.users, {
          id,
          email: `${id}@example.com`,
          name: id,
          role: "member",
          authProvider: "local",
          disabled: false,
        } as never),
    ),
  );
  await Promise.all(
    ["subscriber", "bystander"].map(
      async (id) => await new MemberModel(db).set("p1", id, "developer"),
    ),
  );
  await new NotificationSubscriptionModel(db).upsert("p1", "subscriber", {
    events: [DESIGN_CHANGED_EVENT],
    via: ["email"],
  });
  await new NotificationSubscriptionModel(db).upsert("p1", "bystander", {
    events: ["build:created"],
    via: ["email"],
  });
  const fake = makeFakeDesign();
  const credentials = new DesignCredentialModel(db, SECRET);
  await credentials.set("p1", "fake", "tok");
  const nodes = new DesignNodeModel(db, credentials, [fake.provider], { storage });
  const sent: unknown[] = [];
  const deps: NotifyDeps = {
    db,
    storage,
    config: { secret: SECRET, ...(publicBaseUrl ? { publicBaseUrl } : {}) },
    ui: {},
    logger: pino({ level: "silent" }),
    notifiers: [recorder("email", sent)],
  } as never;
  const node = (await nodes.refresh("p1", URL_A)) as DesignNode;
  return { deps, nodes, node, sent, fake };
}

function observe(node: DesignNode, patch: Partial<DesignObservation> = {}): DesignObservation[] {
  return [{ url: URL_A, node, componentPath: COMPONENT, baselineVersion: APPROVED, ...patch }];
}

const modifiedAfter = (node: DesignNode): DesignNode => ({
  ...node,
  state: "ok",
  version: "2",
  lastModified: "2026-02-01T00:00:00.000Z",
});

describe("announceDesignChangesWith", () => {
  it("tells subscribers (and only them) and posts the webhook payload once", async () => {
    const { deps, nodes, node, sent } = await setup();
    await announceDesignChangesWith(deps, nodes, PROJECT, observe(modifiedAfter(node)));
    const recipients = sent.map(
      (item) => (item as { channel: { config: { to: string } } }).channel.config.to,
    );
    expect(recipients).toEqual(["subscriber@example.com"]);
    expect(webhooks.emitted).toHaveLength(1);
    expect(webhooks.emitted[0]?.slice(2, 5)).toEqual([
      "p1",
      DESIGN_CHANGED_EVENT,
      {
        projectId: "p1",
        componentPath: COMPONENT,
        figmaUrl: URL_A,
        change: "modified-after-approval",
        designVersion: "2",
      },
    ]);
  });

  it("sends one event per design version even with concurrent health checks", async () => {
    const { deps, nodes, node, sent } = await setup();
    const changed = modifiedAfter(node);
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        await announceDesignChangesWith(deps, nodes, PROJECT, observe(changed));
      }),
    );
    await announceDesignChangesWith(deps, nodes, PROJECT, observe(changed));
    expect(webhooks.emitted).toHaveLength(1);
    expect(sent).toHaveLength(1);
    await announceDesignChangesWith(deps, nodes, PROJECT, observe({ ...changed, version: "3" }));
    expect(webhooks.emitted).toHaveLength(2);
  });

  it("announces a deleted node, keeping its last known version", async () => {
    const { deps, nodes, node } = await setup();
    await announceDesignChangesWith(
      deps,
      nodes,
      PROJECT,
      observe({ ...node, state: "deleted" }, { baselineVersion: null }),
    );
    expect(webhooks.emitted[0]?.[4]).toMatchObject({ change: "deleted", designVersion: "1" });
  });

  it("sends nothing and claims nothing without a confirmed origin", async () => {
    const { deps, nodes, node, sent } = await setup(null);
    const changed = modifiedAfter(node);
    await announceDesignChangesWith(deps, nodes, PROJECT, observe(changed));
    expect(webhooks.emitted).toHaveLength(0);
    expect(sent).toHaveLength(0);
    // the origin appears later: the same change is still announced once
    const withOrigin = {
      ...deps,
      config: { ...deps.config, publicBaseUrl: "https://shelf.example.com" },
    };
    await announceDesignChangesWith(withOrigin, nodes, PROJECT, observe(changed));
    expect(webhooks.emitted).toHaveLength(1);
  });

  it("stays quiet for a current design, a design with no component or an unknown design", async () => {
    const { deps, nodes, node, sent } = await setup();
    await announceDesignChangesWith(deps, nodes, PROJECT, [
      ...observe(node, { baselineVersion: "2026-06-01T00:00:00.000Z" }),
      ...observe(modifiedAfter(node), { componentPath: null }),
      ...observe(node, { node: undefined }),
    ]);
    expect(webhooks.emitted).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("is best-effort: a failing claim is logged, not thrown", async () => {
    const { deps, node } = await setup();
    const broken = { claimChange: () => Promise.reject(new Error("db down")) };
    const observations = observe(modifiedAfter(node));
    await expect(
      announceDesignChangesWith(deps, broken, PROJECT, observations),
    ).resolves.toBeUndefined();
    expect(webhooks.emitted).toHaveLength(0);
  });
});
