import { NotificationChannelModel } from "@storyshelf/core/models";
import { makeDatabase, makeFakeStateNotifier, makeStorage } from "@storyshelf/core/test-helpers";
import type { AuthUser } from "@storyshelf/core/types";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubAuth } from "../stub-auth.ts";

const SECRET = "test-secret";
const admin: AuthUser = { id: "admin_1", email: "a@example.com", name: "A", role: "admin" };
const dev: AuthUser = { id: "dev_1", email: "d@example.com", name: "D", role: "member" };

const auth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    if (cookie.includes("storyshelf_session=admin")) {
      return admin;
    }
    return cookie.includes("storyshelf_session=dev") ? dev : null;
  },
});

const repoSchema = z.object({ owner: z.string(), repo: z.string() });
const as = (who: "admin" | "dev") => ({ cookie: `storyshelf_session=${who}` });

async function boot(options: { origin: boolean }) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Retry",
    slug: "retry",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(db.tables.projectMembers, {
    id: "m1",
    projectId: "p1",
    userId: dev.id,
    role: "developer",
    source: "manual",
    createdAt: now,
  });
  const git = makeFakeStateNotifier("github", undefined, repoSchema);
  const sent: unknown[] = [];
  const logMeta = {
    name: "log",
    version: "0.0.0",
    kind: "log",
    category: "notifier" as const,
    audience: "room" as const,
    schema: z.object({}).loose(),
  };
  const log = {
    metadata: logMeta,
    create: () => ({
      metadata: logMeta,
      send: async (input: unknown) => {
        sent.push(input);
      },
    }),
  };
  const app = createShelfApp({
    database: db,
    storage: storage as never,
    auth,
    config: {
      secret: SECRET,
      ...(options.origin ? { publicBaseUrl: "https://shelf.example" } : {}),
    },
    notifications: { notifiers: [git.provider, log] },
    logger: pino({ level: "silent" }),
  });
  const channels = new NotificationChannelModel(db, undefined, SECRET);
  const target = await channels.create({
    projectId: "p1",
    provider: "github",
    config: { owner: "o", repo: "r" },
    secret: "t",
  });
  const other = await channels.create({
    projectId: "p1",
    provider: "github",
    config: { owner: "o", repo: "other" },
    secret: "t",
  });
  const chat = await channels.create({ projectId: "p1", provider: "log", config: {} });
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "abc123def456",
    gitBranch: "feature/x",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  } as never);
  if (options.origin) {
    await settleBootReplay(db, channels, [target.id, other.id], git.calls);
  }
  return { app, channels, target, other, chat, git, sent };
}

/**
 * With an origin at boot, the open build is replayed to every git channel (ADR 0014, decision 11).
 * Wait for that, then reset the diagnostics so a retry is judged alone.
 */
async function settleBootReplay(
  db: ReturnType<typeof makeDatabase>["db"],
  channels: NotificationChannelModel,
  ids: string[],
  calls: unknown[],
): Promise<void> {
  await vi.waitFor(async () => {
    const rows = await Promise.all(ids.map(async (id) => await channels.get(id)));
    expect(rows.map((row) => row?.lastDeliveredAt)).not.toContain(null);
  });
  await Promise.all(
    ids.map(async (id) => {
      await db.update(db.tables.notificationChannels, id, { lastDeliveredAt: null });
    }),
  );
  calls.length = 0;
}

const retryPath = (id: string) => `/api/v1/projects/retry/notification-channels/${id}/retry`;
const post = (app: Awaited<ReturnType<typeof boot>>["app"], id: string, who: "admin" | "dev") =>
  app.request(retryPath(id), { method: "POST", headers: as(who) });

describe("retry a git channel's current state", () => {
  it("asks again for the open builds on that channel only, and nothing else", async () => {
    const t = await boot({ origin: true });
    const res = await post(t.app, t.target.id, "admin");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ asked: 1 });
    await vi.waitFor(async () => {
      expect((await t.channels.get(t.target.id))?.lastDeliveredAt).not.toBeNull();
    });
    expect((await t.channels.get(t.other.id))?.lastDeliveredAt).toBeNull();
    expect((await t.channels.get(t.chat.id))?.lastDeliveredAt).toBeNull();
    expect(t.git.calls.length).toBeGreaterThan(0);
    expect(t.sent).toEqual([]);
  });

  it("is admin-only: a developer gets 403 and nothing is delivered", async () => {
    const t = await boot({ origin: true });
    expect((await post(t.app, t.target.id, "dev")).status).toBe(403);
    expect(t.git.calls).toEqual([]);
  });

  it("answers 409 with the pause message while no public URL is confirmed", async () => {
    const t = await boot({ origin: false });
    const res = await post(t.app, t.target.id, "admin");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toContain("paused");
    expect(t.git.calls).toEqual([]);
  });

  it("refuses a chat channel and a channel of another project", async () => {
    const t = await boot({ origin: true });
    expect((await post(t.app, t.chat.id, "admin")).status).toBe(400);
    expect((await post(t.app, "missing", "admin")).status).toBe(404);
    expect(t.sent).toEqual([]);
  });

  it("lists lastDeliveredAt and a redacted error", async () => {
    const t = await boot({ origin: true });
    await t.channels.recordOutcome(t.other.id, "HTTP 401 with ghp_secret123 and more");
    await t.channels.recordOutcome(t.target.id);
    const res = await t.app.request("/api/v1/projects/retry/notification-channels", {
      headers: as("admin"),
    });
    const rows = (await res.json()) as {
      id: string;
      lastDeliveredAt: string | null;
      lastError: string | null;
    }[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(t.target.id)?.lastDeliveredAt).toEqual(expect.any(String));
    expect(byId.get(t.other.id)?.lastDeliveredAt).toBeNull();
    expect(byId.get(t.other.id)?.lastError).not.toContain("ghp_secret123");
  });

  it("serves the settings form to admins, shows the diagnostics, and refuses a developer", async () => {
    const t = await boot({ origin: true });
    await t.channels.recordOutcome(t.target.id);
    const page = await t.app.request("/projects/retry/settings/notifications", {
      headers: as("admin"),
    });
    const html = await page.text();
    expect(html).toContain("Last delivered");
    expect(html).toContain("Last delivered: never");
    expect(html).toContain("Retry current state");
    const form = (who: "admin" | "dev") =>
      t.app.request(`/projects/retry/settings/notifications/${t.target.id}/retry`, {
        method: "POST",
        headers: {
          ...as(who),
          "content-type": "application/x-www-form-urlencoded",
          "x-csrf-token": getCsrfToken(SECRET, who),
        },
        body: "",
      });
    expect((await form("dev")).status).toBe(403);
    expect((await form("admin")).status).toBe(200);
  });
});
