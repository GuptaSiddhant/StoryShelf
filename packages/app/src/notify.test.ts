import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import {
  MemberModel,
  NotificationChannelModel,
  NotificationSubscriptionModel,
} from "@storyshelf/core/models";
import { makeDatabase, makeFakeStateNotifier, makeStorage } from "@storyshelf/core/test-helpers";
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
    config: { secret: SECRET, publicBaseUrl: "https://shelf.example.com" },
    ui: {},
    logger: pino({ level: "silent" }),
    user: null,
    authEnabled: false,
    testing: false,
    sessionId: "test",
    design: [],
    notifiers,
  };
}

/** What a project event's notification carries, as JSON, when delivered from `store`. */
async function deliver(store: Store): Promise<string> {
  const sent: unknown[] = [];
  const wired = { ...store, notifiers: [recordingProvider("log", sent)] };
  await runWithStore(wired, async () => {
    await notifyProject({ id: "p1", slug: "test-project" }, "build:created", {}, "/builds/b1");
  });
  return JSON.stringify(sent);
}

async function seedUsers(db: ReturnType<typeof makeDatabase>["db"]): Promise<void> {
  await seedProject(db);
  const roles = { admin1: "admin", appr1: "approver", appr2: "approver", dev1: "developer" };
  await Promise.all(
    Object.entries(roles).map(async ([id, role]) => {
      await db.insert(db.tables.users, {
        id,
        email: `${id}@example.com`,
        name: id,
        avatarUrl: null,
        role: "member",
        lastLoginAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        passwordHash: null,
        displayNameOverride: null,
        authProvider: "local",
        disabled: false,
      });
      await new MemberModel(db).set("p1", id, role as "admin");
    }),
  );
}

async function recipients(
  db: ReturnType<typeof makeDatabase>["db"],
  event: string,
): Promise<string[]> {
  const emailed: { channel: { config: { to: string } } }[] = [];
  await runWithStore(
    storeFor(db, [recordingProvider("email", emailed)]),
    async () => await notifyProject({ id: "p1", slug: "test-project" }, event, { buildId: "b1" }),
  );
  return emailed.map((item) => item.channel.config.to).toSorted();
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

  it("records a failed delivery on the channel and clears it after the next success", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    const model = new NotificationChannelModel(db, undefined, SECRET);
    const channel = await model.create({ projectId: "p1", provider: "log", config: {} });
    let failing = true;
    const metadata = {
      name: "log",
      version: "0.0.0",
      kind: "log",
      category: "notifier" as const,
      schema: {} as never,
    };
    const flaky: NotifierProvider = {
      metadata,
      create: () => ({
        metadata,
        // oxlint-disable-next-line eslint/require-await -- send is async by contract
        send: async () => {
          if (failing) {
            throw new Error("webhook returned 500");
          }
        },
      }),
    };
    const run = async (): Promise<void> => {
      await runWithStore(storeFor(db, [flaky]), async () => {
        await notifyProject({ id: "p1", slug: "test-project" }, "build:created", {});
      });
    };

    await run();
    expect((await model.get(channel.id))?.lastError).toBe("webhook returned 500");

    failing = false;
    await run();
    expect((await model.get(channel.id))?.lastError).toBeNull();
  });

  it("never sends chat messages to git (state) channels", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    await new NotificationChannelModel(db, undefined, SECRET).create({
      projectId: "p1",
      provider: "fake-git",
      config: { owner: "acme", repo: "widgets" },
      secret: "token",
    });
    const git = makeFakeStateNotifier("fake-git");
    await runWithStore(storeFor(db, [git.provider]), async () => {
      await notifyProject({ id: "p1", slug: "test-project" }, "build:created", {});
    });
    expect(git.calls).toHaveLength(0);
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

  describe("review:requested (on by default for approvers and admins)", () => {
    it("reaches approvers and admins without a subscription, never developers", async () => {
      const { db } = makeDatabase();
      await seedUsers(db);
      expect(await recipients(db, "review:requested")).toEqual([
        "admin1@example.com",
        "appr1@example.com",
        "appr2@example.com",
      ]);
    });

    it("lets a reviewer opt out by turning their subscription off or narrowing its topics", async () => {
      const { db } = makeDatabase();
      await seedUsers(db);
      const subscriptions = new NotificationSubscriptionModel(db);
      await subscriptions.upsert("p1", "appr1", { enabled: false });
      await subscriptions.upsert("p1", "appr2", { events: ["build:approved"] });
      expect(await recipients(db, "review:requested")).toEqual(["admin1@example.com"]);
    });

    it("sends a subscribed reviewer one message, and other topics stay opt-in", async () => {
      const { db } = makeDatabase();
      await seedUsers(db);
      await new NotificationSubscriptionModel(db).upsert("p1", "appr1", { via: ["email"] });
      expect(await recipients(db, "review:requested")).toEqual([
        "admin1@example.com",
        "appr1@example.com",
        "appr2@example.com",
      ]);
      expect(await recipients(db, "review:verdict")).toEqual(["appr1@example.com"]);
    });
  });

  it("links to the resolved public origin", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    await new NotificationChannelModel(db, undefined, SECRET).create({
      projectId: "p1",
      provider: "log",
      config: {},
      events: ["build:created"],
    });
    const detected = { url: async () => await Promise.resolve("https://detected.example.com/") };
    expect(await deliver({ ...storeFor(db, []), publicOrigin: detected as never })).toContain(
      "https://detected.example.com/projects/test-project/builds/b1",
    );
  });

  it("is paused while no public origin resolves: nothing is sent, the channel is not errored, one log line", async () => {
    const { db } = makeDatabase();
    await seedProject(db);
    const channel = await new NotificationChannelModel(db, undefined, SECRET).create({
      projectId: "p1",
      provider: "log",
      config: {},
      events: ["build:created"],
    });
    const lines: string[] = [];
    const logger = pino({ level: "warn" }, { write: (line: string) => lines.push(line) });
    let origin: string | undefined;
    const resolver = { url: async () => await Promise.resolve(origin) } as never;
    const sent: unknown[] = [];
    const store = {
      ...storeFor(db, [recordingProvider("log", sent)]),
      logger,
      config: { secret: SECRET },
      publicOrigin: resolver,
    };
    await runWithStore(store, async () => {
      await notifyProject({ id: "p1", slug: "test-project" }, "build:created", {}, "/builds/b1");
      await notifyProject({ id: "p1", slug: "test-project" }, "build:created", {}, "/builds/b1");
      await notifySystem("sys:purge-completed", { removedBuilds: 3 });
    });
    expect(sent).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Notifications are paused until a public URL is set");
    expect(
      (await new NotificationChannelModel(db, undefined, SECRET).get(channel.id))?.lastError,
    ).toBeNull();

    origin = "https://shelf.example.com";
    await runWithStore(store, async () => {
      await notifyProject({ id: "p1", slug: "test-project" }, "build:created", {}, "/builds/b1");
    });
    expect(sent).toHaveLength(1);
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
