import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import { createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import {
  BuildModel,
  CaptureJobModel,
  MemberModel,
  NotificationChannelModel,
  ProjectModel,
} from "@storyshelf/core/models";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { notifyProjectWith, type NotifyDeps } from "./notify.ts";
import { reviewRequestedData } from "./review-events.ts";
import {
  createReviewRequestEnqueuer,
  createReviewRequestHandler,
  reviewRequestExhausted,
} from "./review-request-job.ts";

/** The reviewers the owner rules assign, which a test sets directly. */
const assigned = vi.hoisted(() => ({ list: [] as { userId: string; components: string[] }[] }));

vi.mock("./review-assignment.ts", async (original) => ({
  ...(await original<typeof import("./review-assignment.ts")>()),
  assignedReviewersOf: () => Promise.resolve(assigned.list),
}));

const SECRET = "test-server-secret-32-chars-long!!";
const CONTEXT = {
  logger: pino({ level: "silent" }),
  touch: () => {},
  signal: new AbortController().signal,
};

/** A person-addressed (email) and a room (chat) notifier that record what they send. */
function notifiers(
  sent: string[],
  failing: { chat: boolean },
  inputs: unknown[],
): NotifierProvider[] {
  const make = (kind: string, audience: "person" | "room"): NotifierProvider => {
    const metadata = {
      name: kind,
      version: "0.0.0",
      kind,
      category: "notifier" as const,
      audience,
      schema: {} as never,
    };
    return {
      metadata,
      create: () => ({
        metadata,
        // oxlint-disable-next-line eslint/require-await -- send is async by contract
        send: async (input: { channel: { id: string } }) => {
          inputs.push(input);
          if (kind === "chat" && failing.chat) {
            throw new Error("room refused");
          }
          sent.push(`${kind}:${input.channel.id}`);
        },
      }),
    };
  };
  return [make("email", "person"), make("chat", "room")];
}

async function setup(options: { origin?: boolean; queued?: boolean } = {}) {
  const { db } = makeDatabase();
  const sent: string[] = [];
  const inputs: unknown[] = [];
  const failing = { chat: false };
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
  const channel = await new NotificationChannelModel(db, undefined, SECRET).create({
    projectId: project.id,
    provider: "chat",
    name: "room",
    config: { url: "https://chat.example.com/hook" },
    events: [],
  } as never);
  const queue = createDatabaseCaptureQueue(db, { kinds: ["notify", "review-request"], retries: 4 });
  const deps: NotifyDeps = {
    db,
    config: {
      secret: SECRET,
      ...(options.origin === false ? {} : { publicBaseUrl: "https://shelf.example.com" }),
    },
    ui: {},
    logger: pino({ level: "silent" }),
    notifiers: notifiers(sent, failing, inputs),
  };
  const enqueue = createReviewRequestEnqueuer(deps, { get: () => queue });
  const queued: NotifyDeps = options.queued === false ? deps : { ...deps, reviewRequests: enqueue };
  const data = reviewRequestedData(build);
  const announce = async () => {
    await notifyProjectWith(queued, project, "review:requested", data, `/builds/${build.id}`);
  };
  return { db, sent, inputs, failing, project, build, channel, queue, deps, announce, enqueue };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

/** Run the jobs queued now once each (at most `limit`), a failed one requeued; the number run. */
async function drain(fixture: Fixture, limit = 2): Promise<number> {
  const handler = createReviewRequestHandler(fixture.deps);
  let ran = 0;
  /* oxlint-disable eslint/no-await-in-loop -- the jobs run one after another, as the consumer does */
  while (ran < limit) {
    const job = await fixture.queue.poll();
    if (job === null) {
      break;
    }
    ran += 1;
    try {
      await handler.run(job, CONTEXT);
      await fixture.queue.ack(job);
    } catch (error) {
      await fixture.queue.nack(job, {
        requeue: true,
        delayMs: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return ran;
}

const person = (route: "default" | "assigned") => ({
  kind: "user" as const,
  userId: "appr1",
  provider: "email",
  route,
});

describe("review-request jobs", () => {
  it("queues one job per recipient, with references only", async () => {
    const fx = await setup();
    await fx.announce();
    expect(fx.sent).toEqual([]);
    const rows = await new CaptureJobModel(fx.db).listForBuild(fx.build.id);
    expect(rows.map((row) => row.kind)).toEqual(["review-request", "review-request"]);
    const stored = rows.map((row) => row.payload ?? "").join("\n");
    expect(stored).not.toContain("appr1@example.com");
    expect(stored).not.toContain("chat.example.com");
    expect(stored).not.toContain("shelf.example.com");
  });

  it("delivers to each recipient once, and a failed one is retried alone", async () => {
    const fx = await setup();
    fx.failing.chat = true;
    await fx.announce();
    await drain(fx);
    expect(fx.sent).toEqual([expect.stringMatching(/^email:default:/u)]);
    fx.failing.chat = false;
    expect(await drain(fx)).toBe(1);
    expect(fx.sent).toHaveLength(2);
    expect(fx.sent.filter((entry) => entry.startsWith("email:"))).toHaveLength(1);
  });

  it("queues a repeated request for the same event and target only once", async () => {
    const fx = await setup();
    await fx.announce();
    await fx.announce();
    const rows = await new CaptureJobModel(fx.db).listForBuild(fx.build.id);
    expect(rows).toHaveLength(2);
    await drain(fx);
    await fx.announce();
    expect(await new CaptureJobModel(fx.db).listForBuild(fx.build.id)).toHaveLength(2);
  });

  it("sends nothing and does not retry while no origin is confirmed", async () => {
    const fx = await setup();
    await fx.announce();
    const paused = { ...fx, deps: { ...fx.deps, config: { secret: SECRET } } };
    expect(await drain(paused)).toBe(2);
    expect(fx.sent).toEqual([]);
    expect(await fx.queue.poll()).toBeNull();
  });

  it("sends nothing once the build is no longer waiting for a verdict", async () => {
    const fx = await setup();
    await fx.announce();
    await new BuildModel(fx.db).update(fx.build.id, { status: "approved" });
    await drain(fx);
    expect(fx.sent).toEqual([]);
  });

  it("sends nothing to a channel deleted after the job was queued", async () => {
    const fx = await setup();
    await fx.announce();
    await new NotificationChannelModel(fx.db, undefined, SECRET).remove(fx.channel.id);
    await drain(fx);
    expect(fx.sent).toEqual([expect.stringMatching(/^email:/u)]);
  });

  it("records a given-up delivery on the channel and raises no admin event", async () => {
    const fx = await setup();
    fx.failing.chat = true;
    await fx.announce();
    const handler = createReviewRequestHandler(fx.deps);
    const job = (await fx.queue.poll()) ?? (await fx.queue.poll());
    const chat = [job, await fx.queue.poll()].find(
      (entry) =>
        entry?.data?.["target"] !== undefined && JSON.stringify(entry.data).includes("channel"),
    );
    expect(chat).toBeDefined();
    await expect(
      handler.run({ ...chat!, attempt: 5, attempts: 4, maxAttempts: 5 }, CONTEXT),
    ).rejects.toThrow("room refused");
    const row = await new NotificationChannelModel(fx.db, undefined, SECRET).get(fx.channel.id);
    expect(row?.lastError).toContain("room refused");
  });

  it("shows an exhausted job's error on its channel", async () => {
    const fx = await setup();
    await reviewRequestExhausted(fx.deps)(
      {
        buildId: fx.build.id,
        jobId: "j",
        kind: "review-request",
        attempt: 5,
        attempts: 4,
        maxAttempts: 5,
        receipt: "r",
        leaseMs: 1,
        data: {
          projectId: fx.project.id,
          eventId: `${fx.build.id}:0`,
          target: { kind: "channel", channelId: fx.channel.id },
        },
      },
      "lease lost",
    );
    const row = await new NotificationChannelModel(fx.db, undefined, SECRET).get(fx.channel.id);
    expect(row?.lastError).toContain("lease lost");
  });

  it("delivers directly, as before, where no queue is polled", async () => {
    const fx = await setup({ queued: false });
    await fx.announce();
    expect(fx.sent).toHaveLength(2);
    expect(await new CaptureJobModel(fx.db).listForBuild(fx.build.id)).toEqual([]);
  });

  it("falls back to direct delivery for a recipient whose job could not be queued", async () => {
    const fx = await setup();
    const broken: NotifyDeps = {
      ...fx.deps,
      reviewRequests: async () => {
        throw new Error("queue down");
      },
    };
    await notifyProjectWith(
      broken,
      fx.project,
      "review:requested",
      reviewRequestedData(fx.build),
      `/builds/${fx.build.id}`,
    );
    expect(fx.sent).toHaveLength(2);
  });

  it("fails a malformed job without running it", () => {
    const handler = createReviewRequestHandler({} as NotifyDeps);
    expect(handler.accepts?.({ buildId: "b", data: { projectId: "p" } } as never)).toBe(false);
  });
  it("tells an assigned reviewer why they were asked", async () => {
    const fx = await setup();
    assigned.list = [{ userId: "appr1", components: ["Button"] }];
    const eventId = `${fx.build.id}:0`;
    await fx.enqueue({ projectId: fx.project.id, eventId, target: person("assigned") });
    await drain(fx);
    assigned.list = [];
    expect(fx.sent).toEqual([expect.stringMatching(/^email:/u)]);
    expect(JSON.stringify(fx.inputs)).toContain("because you own Button");
  });

  it("sends nothing to a default recipient who has been assigned since", async () => {
    const fx = await setup();
    assigned.list = [{ userId: "appr1", components: ["Button"] }];
    const eventId = `${fx.build.id}:0`;
    await fx.enqueue({ projectId: fx.project.id, eventId, target: person("default") });
    await drain(fx);
    assigned.list = [];
    expect(fx.sent).toEqual([]);
  });

  it("sends nothing to a person disabled after the job was queued", async () => {
    const fx = await setup();
    await fx.enqueue({
      projectId: fx.project.id,
      eventId: `${fx.build.id}:0`,
      target: person("default"),
    });
    await fx.db.update(fx.db.tables.users, "appr1", { disabled: true });
    await drain(fx);
    expect(fx.sent).toEqual([]);
  });

  it("refuses a job whose target has an unknown route", () => {
    const handler = createReviewRequestHandler({} as NotifyDeps);
    const data = { projectId: "p", eventId: "b:0", target: { ...person("default"), route: "x" } };
    expect(handler.accepts?.({ buildId: "b", data } as never)).toBe(false);
  });
});
