import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import { NotificationChannelModel, NotificationSubscriptionModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { notifyProject, notifySystem } from "./notify.ts";
import { runWithStore, type Store } from "./store.ts";

const SECRET = "test-server-secret-32-chars-long!!";

const PROJECT = {
  id: "p1",
  name: "Test Project",
  slug: "test-project",
  gitRepository: null,
  gitDefaultBranch: "main",
  pixelThreshold: 0.1,
  maxDiffRatio: 0.01,
  publicBranchRegex: null,
  executePlay: false,
  playTimeoutMs: 10_000,
  storybookMeta: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function recordingProvider(kind: string, sent: unknown[]): NotifierProvider {
  const metadata = {
    name: kind,
    version: "0.0.0",
    kind,
    category: "notifier" as const,
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

async function seedProject(db: ReturnType<typeof makeDatabase>["db"]): Promise<void> {
  await db.insert(db.tables.projects, PROJECT);
}

function storeFor(db: ReturnType<typeof makeDatabase>["db"], notifiers: NotifierProvider[]): Store {
  const { storage } = makeStorage();
  return {
    db,
    storage,
    config: { secret: SECRET },
    ui: {},
    logger: pino({ level: "silent" }),
    user: null,
    authEnabled: false,
    sessionId: "test",
    gitHosts: [],
    notifiers,
  };
}

describe("notifyProject", () => {
  it("delivers project events to stored channels", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    await new NotificationChannelModel(db, undefined, SECRET).create({
      projectId: "p1",
      provider: "log",
      config: {},
      events: ["build:created"],
    });
    const sent: unknown[] = [];
    await runWithStore(storeFor(db, [recordingProvider("log", sent)]), async () => {
      await notifyProject({ id: "p1", slug: "test-project" }, "build:created", { buildId: "b1" });
    });
    expect(sent).toHaveLength(1);
  });

  it("skips channels whose secret cannot be decrypted", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    await new NotificationChannelModel(db, undefined, "other-secret").create({
      projectId: "p1",
      provider: "log",
      config: {},
      secret: "shh",
    });
    const sent: unknown[] = [];
    await runWithStore(storeFor(db, [recordingProvider("log", sent)]), async () => {
      await notifyProject({ id: "p1", slug: "test-project" }, "build:created", {});
    });
    expect(sent).toHaveLength(0);
  });

  it("emails opted-in subscribers only when an email provider is wired", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    await db.insert(db.tables.users, {
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      avatarUrl: null,
      role: "member",
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      passwordHash: null,
      displayNameOverride: null,
      authProvider: "local",
      disabled: false,
    });
    await new NotificationSubscriptionModel(db).upsert("p1", "u1", { via: ["email"] });
    const emailed: unknown[] = [];
    const logged: unknown[] = [];
    const email = recordingProvider("email", emailed);
    const log = recordingProvider("log", logged);
    await runWithStore(storeFor(db, [log]), async () => {
      await notifyProject({ id: "p1", slug: "test-project" }, "build:reviewing", {});
    });
    expect(emailed).toHaveLength(0);
    await runWithStore(storeFor(db, [log, email]), async () => {
      await notifyProject({ id: "p1", slug: "test-project" }, "build:reviewing", {});
    });
    expect(emailed).toHaveLength(1);
    expect(emailed[0]).toMatchObject({ channel: expect.objectContaining({ provider: "email" }) });
  });

  it("is a no-op without wired notifiers", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    await runWithStore(storeFor(db, []), async () => {
      await notifyProject({ id: "p1", slug: "test-project" }, "build:created", {});
    });
  });
});

describe("notifySystem", () => {
  it("delivers only to project-less channels", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    const channels = new NotificationChannelModel(db, undefined, SECRET);
    await channels.create({ projectId: "p1", provider: "log", config: {} });
    await channels.create({ projectId: null, provider: "log", config: {} });
    const sent: unknown[] = [];
    await runWithStore(storeFor(db, [recordingProvider("log", sent)]), async () => {
      await notifySystem("sys:purge-completed", { removedBuilds: 3 });
    });
    expect(sent).toHaveLength(1);
  });
});
