import { createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import {
  BuildModel,
  CaptureJobModel,
  MemberModel,
  NotificationSubscriptionModel,
  ProjectModel,
  PushSubscriptionModel,
} from "@storyshelf/core/models";
import { makeDatabase, publicNetworkForTests } from "@storyshelf/core/test-helpers";
import { createECDH } from "node:crypto";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyProjectWith, type NotifyDeps } from "./notify.ts";
import { reviewRequestedData } from "./review-events.ts";
import { createReviewRequestEnqueuer } from "./review-request-data.ts";
import { createReviewRequestHandler } from "./review-request-job.ts";
import { resolveRuntime } from "./runtime.ts";

const SECRET = "test-server-secret-32-chars-long!!";
const CONTEXT = {
  logger: pino({ level: "silent" }),
  touch: () => {},
  signal: new AbortController().signal,
};

function keyPair(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  };
}

const device = keyPair();
const ENDPOINT = "https://push.example.net/p/device-token";

let restoreNetwork: () => void = () => {};
beforeEach(() => {
  restoreNetwork = publicNetworkForTests();
});
afterEach(() => {
  restoreNetwork();
  vi.unstubAllGlobals();
});

async function setup(origin: string | null = "https://shelf.example.com") {
  const { db } = makeDatabase();
  const project = await new ProjectModel(db).create({ name: "P", gitRepository: "o/r" });
  const build = await new BuildModel(db).create(project.id, { gitSha: "abc", gitBranch: "main" });
  await db.insert(db.tables.users, {
    id: "appr1",
    email: "appr1@example.com",
    name: "appr1",
    avatarUrl: null,
    role: "member",
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    passwordHash: null,
    displayNameOverride: null,
    authProvider: "local",
    disabled: false,
  });
  await new MemberModel(db).set(project.id, "appr1", "approver");
  await new NotificationSubscriptionModel(db).upsert(project.id, "appr1", {
    via: ["push"],
    events: ["review:requested", "build:failed"],
  });
  const row = await new PushSubscriptionModel(db).add("appr1", {
    endpoint: ENDPOINT,
    p256dh: device.publicKey,
    auth: Buffer.alloc(16, 9).toString("base64url"),
  });
  const runtime = resolveRuntime({
    database: db,
    storage: {} as never,
    config: { secret: SECRET, ...(origin === null ? {} : { publicBaseUrl: origin }) },
    logger: pino({ level: "silent" }),
    notifications: {
      vapid: { ...keyPair(), subject: "mailto:ops@example.com" },
    },
  });
  const queue = createDatabaseCaptureQueue(db, { kinds: ["notify", "review-request"], retries: 4 });
  const deps: NotifyDeps = {
    db,
    config: { secret: SECRET, ...(origin === null ? {} : { publicBaseUrl: origin }) },
    ui: {},
    logger: pino({ level: "silent" }),
    notifiers: runtime.notifiers,
  };
  const queued = {
    ...deps,
    reviewRequests: createReviewRequestEnqueuer(deps, { get: () => queue }),
  };
  const announce = async () => {
    await notifyProjectWith(
      queued,
      project,
      "review:requested",
      reviewRequestedData(build),
      `/builds/${build.id}`,
    );
  };
  return { db, project, build, queue, deps, announce, row };
}

/** Run the next job once; whether it was acked. */
async function runOne(fx: Awaited<ReturnType<typeof setup>>): Promise<"acked" | "failed" | "none"> {
  const job = await fx.queue.poll();
  if (job === null) {
    return "none";
  }
  try {
    await createReviewRequestHandler(fx.deps).run(job, CONTEXT);
    await fx.queue.ack(job);
    return "acked";
  } catch (error) {
    await fx.queue.nack(job, {
      requeue: true,
      delayMs: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }
}

describe("web push review requests", () => {
  it("queues one job per device, holding the device id and no endpoint or key", async () => {
    const fx = await setup();
    await fx.announce();
    const rows = await new CaptureJobModel(fx.db).listForBuild(fx.build.id);
    expect(rows).toHaveLength(1);
    const stored = rows[0]?.payload ?? "";
    expect(stored).toContain(fx.row.id);
    expect(stored).not.toContain("push.example.net");
    expect(stored).not.toContain(device.publicKey);
  });

  it("delivers a title, a one-line body and a relative path", async () => {
    const fx = await setup();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 201 })));
    vi.stubGlobal("fetch", fetchMock);
    await fx.announce();
    expect(await runOne(fx)).toBe("acked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(ENDPOINT);
  });

  it("deletes the device's row when the push service says it is gone, and does not retry", async () => {
    const fx = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("gone", { status: 410 }))),
    );
    await fx.announce();
    expect(await runOne(fx)).toBe("acked");
    expect(await new PushSubscriptionModel(fx.db).findByEndpoint(ENDPOINT)).toBeNull();
    expect(await runOne(fx)).toBe("none");
  });

  it("retries any other failure and keeps the device", async () => {
    const fx = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("busy", { status: 503 }))),
    );
    await fx.announce();
    expect(await runOne(fx)).toBe("failed");
    expect(await new PushSubscriptionModel(fx.db).findByEndpoint(ENDPOINT)).not.toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 201 }))),
    );
    expect(await runOne(fx)).toBe("acked");
  });

  it("sends nothing without a confirmed origin", async () => {
    const fx = await setup(null);
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 201 })));
    vi.stubGlobal("fetch", fetchMock);
    await fx.announce();
    expect(await new CaptureJobModel(fx.db).listForBuild(fx.build.id)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is off until the person registers a device", async () => {
    const fx = await setup();
    await new PushSubscriptionModel(fx.db).remove(fx.row.id);
    await fx.announce();
    expect(await new CaptureJobModel(fx.db).listForBuild(fx.build.id)).toHaveLength(0);
  });

  it("is off when the subscription does not list push", async () => {
    const fx = await setup();
    await new NotificationSubscriptionModel(fx.db).upsert(fx.project.id, "appr1", {
      via: ["email"],
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 201 })));
    vi.stubGlobal("fetch", fetchMock);
    await fx.announce();
    await runOne(fx);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("what a device is sent", () => {
  it("carries a one-line summary and the build link under the confirmed origin", async () => {
    const fx = await setup();
    const seen: Array<{ summary?: string; url?: string }> = [];
    const metadata = {
      name: "push",
      version: "0.0.0",
      kind: "push",
      category: "notifier" as const,
      audience: "person" as const,
      schema: {} as never,
    };
    const recorder = {
      metadata,
      create: () => ({
        metadata,
        // oxlint-disable-next-line eslint/require-await -- send is async by contract
        send: async (input: { formatted: { summary?: string; url?: string } }) => {
          seen.push(input.formatted);
        },
      }),
    };
    await fx.announce();
    const job = await fx.queue.poll();
    await createReviewRequestHandler({ ...fx.deps, notifiers: [recorder] }).run(
      job as NonNullable<typeof job>,
      CONTEXT,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(
      `https://shelf.example.com/projects/${fx.project.slug}/builds/${fx.build.id}`,
    );
    expect(seen[0]?.summary).toContain("review:requested");
    expect(seen[0]?.summary).not.toContain("\n");
  });
});

describe("push in the runtime", () => {
  it("stays off, with one error line, for a key pair that does not match", () => {
    const lines: unknown[] = [];
    const runtime = resolveRuntime({
      database: makeDatabase().db,
      storage: {} as never,
      logger: { error: (...a: unknown[]) => lines.push(a), child: () => ({}) } as never,
      notifications: {
        vapid: {
          publicKey: keyPair().publicKey,
          privateKey: keyPair().privateKey,
          subject: "mailto:ops@example.com",
        },
      },
    });
    expect(runtime.push).toBeUndefined();
    expect(runtime.notifiers.some((entry) => entry.metadata.kind === "push")).toBe(false);
    expect(lines).toHaveLength(1);
  });

  it("wires the push notifier and identity with a valid pair", () => {
    const runtime = resolveRuntime({
      database: makeDatabase().db,
      storage: {} as never,
      logger: pino({ level: "silent" }),
      notifications: { vapid: { ...keyPair(), subject: "mailto:ops@example.com" } },
    });
    expect(runtime.push?.publicKey).toBeTruthy();
    expect(runtime.notifiers.map((entry) => entry.metadata.kind)).toContain("push");
  });
});
