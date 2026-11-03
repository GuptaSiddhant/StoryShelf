/** `comment:mentioned` routing (#463): one directed message, never a room, never twice. */
import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import {
  MemberModel,
  NotificationChannelModel,
  NotificationSubscriptionModel,
} from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { notifyMentionWith, notifyProject } from "./notify.ts";
import { runWithStore, type Store } from "./store.ts";

type Db = ReturnType<typeof makeDatabase>["db"];
const SECRET = "test-server-secret-32-chars-long!!";
const T0 = "2026-01-01T00:00:00.000Z";
const PROJECT = { id: "p1", slug: "test-project" };

interface Sent {
  kind: string;
  to: string;
  /** The formatted subject, which names the event (`[Shelf] comment:mentioned on ...`). */
  subject: string;
}

function provider(kind: string, sent: Sent[]): NotifierProvider {
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
        const { channel, formatted } = input as {
          channel: { config: { to?: string } };
          formatted: { subject: string };
        };
        sent.push({ kind, to: channel.config.to ?? "(room)", subject: formatted.subject });
      },
    }),
  };
}

async function seed(db: Db, disabled: string[] = []): Promise<void> {
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "P",
    slug: "test-project",
    gitDefaultBranch: "main",
    pixelThreshold: 0.1,
    maxDiffRatio: 0.01,
    createdAt: T0,
    updatedAt: T0,
  } as never);
  for (const id of ["ada", "bob", "cy"]) {
    // eslint-disable-next-line no-await-in-loop -- three rows, in order
    await db.insert(db.tables.users, {
      id,
      email: `${id}@example.com`,
      name: id,
      avatarUrl: null,
      role: "member",
      lastLoginAt: null,
      createdAt: T0,
      passwordHash: null,
      displayNameOverride: null,
      authProvider: "local",
      disabled: disabled.includes(id),
    } as never);
    // eslint-disable-next-line no-await-in-loop -- three rows, in order
    await new MemberModel(db).set("p1", id, "developer");
  }
}

function storeFor(db: Db, notifiers: NotifierProvider[]): Store {
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
  } as Store;
}

const DATA = { eventId: "c1", commentId: "c1", scope: "build", buildId: "b1", message: "hi" };

async function mention(db: Db, userId: string, kinds: string[]): Promise<Sent[]> {
  const sent: Sent[] = [];
  const store = storeFor(
    db,
    kinds.map((kind) => provider(kind, sent)),
  );
  await notifyMentionWith(store, PROJECT, userId, DATA, "/builds/b1");
  return sent;
}

describe("notifyMentionWith", () => {
  it("emails the mentioned member by default, and nobody else", async () => {
    const { db } = makeDatabase();
    await seed(db);
    const sent = await mention(db, "bob", ["email"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "email", to: "bob@example.com" });
    expect(sent[0]?.subject).toContain("comment:mentioned");
  });

  it("never reaches a stored project channel, even one that admits every event", async () => {
    const { db } = makeDatabase();
    await seed(db);
    await new NotificationChannelModel(db, undefined, SECRET).create({
      projectId: "p1",
      provider: "slack",
      config: {},
      events: [],
    });
    const sent = await mention(db, "bob", ["email", "slack"]);
    expect(sent.map((item) => item.kind)).toEqual(["email"]);
  });

  it("uses the member's own subscription channels when they have an enabled one", async () => {
    const { db } = makeDatabase();
    await seed(db);
    await new NotificationSubscriptionModel(db).upsert("p1", "bob", { via: ["slack"] });
    const sent = await mention(db, "bob", ["email", "slack"]);
    expect(sent.map((item) => item.kind)).toEqual(["slack"]);
  });

  it("sends nothing to a member who turned their subscription off", async () => {
    const { db } = makeDatabase();
    await seed(db);
    await new NotificationSubscriptionModel(db).upsert("p1", "bob", { enabled: false });
    expect(await mention(db, "bob", ["email"])).toEqual([]);
  });

  it("sends nothing without an email provider or to a disabled account", async () => {
    const { db } = makeDatabase();
    await seed(db, ["cy"]);
    expect(await mention(db, "bob", ["slack"])).toEqual([]);
    expect(await mention(db, "cy", ["email"])).toEqual([]);
    expect(await mention(db, "nobody", ["email"])).toEqual([]);
  });

  it("sends nothing at all when no notifier is wired", async () => {
    const { db } = makeDatabase();
    await seed(db);
    expect(await mention(db, "bob", [])).toEqual([]);
  });
});

describe("a member who is subscribed and mentioned", () => {
  it("gets the mention and not the comment: one message", async () => {
    const { db } = makeDatabase();
    await seed(db);
    const subscriptions = new NotificationSubscriptionModel(db);
    await subscriptions.upsert("p1", "bob", { via: ["email"], events: ["comment:created"] });
    await subscriptions.upsert("p1", "cy", { via: ["email"], events: ["comment:created"] });

    const sent: Sent[] = [];
    const store = storeFor(db, [provider("email", sent)]);
    await runWithStore(store, async () => {
      await notifyProject(PROJECT, "comment:created", { ...DATA, scope: "build" }, "/builds/b1", {
        skipUsers: new Set(["bob"]),
      });
    });
    await notifyMentionWith(store, PROJECT, "bob", DATA, "/builds/b1");

    const byUser = Object.groupBy(sent, (item) => item.to);
    const events = (user: string) =>
      byUser[user]?.map((item) => /comment:(created|mentioned)/u.exec(item.subject)?.[0]);
    expect(events("bob@example.com")).toEqual(["comment:mentioned"]);
    expect(events("cy@example.com")).toEqual(["comment:created"]);
  });
});
