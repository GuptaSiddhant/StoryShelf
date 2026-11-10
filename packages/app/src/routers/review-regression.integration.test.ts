import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import {
  BuildModel,
  BuildReviewModel,
  CaptureAttemptModel,
  MemberModel,
  TokenModel,
} from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { ProjectRole } from "@storyshelf/core/types";
import { sha256, storybookDir } from "@storyshelf/core/utils";
import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

/**
 * Regression coverage for who may give a verdict and when (ADR 0013, decision 3): reviewer
 * identity, anonymous review, the publish guard and sign-offs. Each case runs through the JSON API
 * and through the browser form route, which share one handler.
 */

const SHA = "e".repeat(40);
const NOW = "2026-01-01T00:00:00.000Z";
const ROLES: Record<string, ProjectRole> = {
  admin: "admin",
  alice: "approver",
  bob: "approver",
};
const users = [...Object.keys(ROLES), "outsider"].map((id) => ({
  id,
  email: `${id}@example.com`,
  name: id,
  role: id === "admin" ? ("admin" as const) : ("member" as const),
}));
const auth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    const id = /storyshelf_session=(?<id>\w+)/u.exec(cookie)?.groups?.["id"];
    return await Promise.resolve(users.find((user) => user.id === id) ?? null);
  },
});

let scratchDir = "";
/** Every app a test booted, torn down after it even when an assertion failed. */
const apps: { lifecycle: { teardown(): Promise<void> } }[] = [];
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-review-regression-"));
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
  await rm(scratchDir, { recursive: true, force: true });
});

async function boot(
  options: {
    testing?: boolean;
    noAuth?: boolean;
    runner?: CaptureRunner;
    project?: Record<string, unknown>;
  } = {},
) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Gate",
    slug: "gate",
    gitRepository: "acme/widgets",
    gitDefaultBranch: "main",
    reviewEnabled: true,
    reviewApprovals: 1,
    ...options.project,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await Promise.all(
    users.map(async (user) => {
      await db.insert(db.tables.users, {
        ...user,
        avatarUrl: null,
        lastLoginAt: null,
        createdAt: NOW,
      });
    }),
  );
  await Promise.all(
    Object.entries(ROLES)
      .filter(([id]) => id !== "admin")
      .map(async ([id, role]) => await new MemberModel(db).set("p1", id, role)),
  );
  const app = createShelfApp({
    database: db,
    storage,
    ...(options.noAuth === true ? {} : { auth }),
    ...(options.testing === true ? { testing: { runner: options.runner ?? stubRunner() } } : {}),
    config: {
      secret: "s",
      scratchDir,
      publicBaseUrl: "https://shelf.example",
      adminToken: "root-token",
    },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  apps.push(app);
  return { app, db, storage };
}

type Booted = Awaited<ReturnType<typeof boot>>;
/** Who calls: a signed-in user, or a bearer token. */
type Caller = { user: string } | { token: string };
type Channel = "api" | "form";
const CHANNELS: Channel[] = ["api", "form"];

/** A verdict through the JSON API or the browser form route; the status and body come back. */
async function give(
  booted: Booted,
  channel: Channel,
  id: string,
  caller: Caller,
  value: "approved" | "rejected" = "approved",
): Promise<{ status: number; text: string }> {
  const who = "user" in caller ? caller.user : "nobody";
  const identity: Record<string, string> =
    "token" in caller
      ? { authorization: `Bearer ${caller.token}` }
      : { cookie: `storyshelf_session=${caller.user}`, "x-csrf-token": getCsrfToken("s", who) };
  const form = channel === "form";
  const path = form
    ? `/projects/gate/builds/${id}/reviews`
    : `/api/v1/projects/gate/builds/${id}/reviews`;
  const response = await booted.app.request(path, {
    method: "POST",
    headers: {
      ...identity,
      "content-type": form ? "application/x-www-form-urlencoded" : "application/json",
    },
    body: form
      ? new URLSearchParams({ verdict: value }).toString()
      : JSON.stringify({ verdict: value }),
  });
  return { status: response.status, text: await response.text() };
}

/** A build on a feature branch; `uploaded` also publishes its Storybook. */
async function createBuild(booted: Booted, uploaded = true): Promise<string> {
  const created = await booted.app.request("/api/v1/projects/gate/builds", {
    method: "POST",
    headers: { cookie: "storyshelf_session=admin", "content-type": "application/json" },
    body: JSON.stringify({ gitSha: SHA, gitBranch: "feature/x" }),
  });
  expect(created.status).toBe(202);
  const { build } = (await created.json()) as { build: { id: string } };
  if (uploaded) {
    await booted.storage.write(
      `${storybookDir("p1", build.id)}/iframe.html`,
      Buffer.from("<html>"),
    );
    await booted.storage.write(`${storybookDir("p1", build.id)}/manifest.json`, Buffer.from("{}"));
  }
  return build.id;
}

async function page(booted: Booted, user: string, path: string): Promise<string> {
  const response = await booted.app.request(`/projects/gate${path}`, {
    headers: { cookie: `storyshelf_session=${user}` },
  });
  expect(response.status).toBe(200);
  return await response.text();
}

const statusOf = async (booted: Booted, id: string) =>
  (await new BuildModel(booted.db).get(id))?.status;

describe("reviewer identity", () => {
  it("counts a user and that user's own token as one reviewer", async () => {
    const booted = await boot({ project: { reviewApprovals: 2 } });
    const id = await createBuild(booted);
    await new TokenModel(booted.db).create("p1", {
      name: "alice-ci",
      hash: sha256("alice-token"),
      userId: "alice",
    });
    // A bearer token is an API credential: a browser form carries a session, never a token.
    expect((await give(booted, "api", id, { token: "alice-token" })).status).toBe(201);
    expect((await give(booted, "api", id, { user: "alice" })).status).toBe(201);
    expect(await statusOf(booted, id)).toBe("pending");
    await give(booted, "api", id, { user: "bob" });
    expect(await statusOf(booted, id)).toBe("approved");
  });

  it("refuses ownerless, deleted-owner and admin tokens with 403", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    const tokens = new TokenModel(booted.db);
    await tokens.create("p1", { name: "ownerless", hash: sha256("ownerless"), userId: null });
    await tokens.create("p1", { name: "gone", hash: sha256("gone"), userId: "deleted-user" });
    for (const token of ["ownerless", "gone", "root-token"]) {
      // eslint-disable-next-line no-await-in-loop -- few tokens
      expect((await give(booted, "api", id, { token })).status, token).toBe(403);
    }
    expect((await give(booted, "api", id, { token: "root-token" })).text).toContain(
      "A verdict needs a user",
    );
    expect(await statusOf(booted, id)).toBe("pending");
  });

  it("does not take a token on the form route: the browser form needs a session", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    await new TokenModel(booted.db).create("p1", {
      name: "alice-ci",
      hash: sha256("alice-token"),
      userId: "alice",
    });
    expect((await give(booted, "form", id, { token: "alice-token" })).status).toBe(403);
    expect(await statusOf(booted, id)).toBe("pending");
  });
});

describe.each(CHANNELS)("a session user through the %s", (channel) => {
  it("counts once however often they give a verdict", async () => {
    const booted = await boot({ project: { reviewApprovals: 2 } });
    const id = await createBuild(booted);
    await give(booted, channel, id, { user: "alice" });
    await give(booted, channel, id, { user: "alice" });
    expect(await statusOf(booted, id)).toBe("pending");
    await give(booted, channel, id, { user: "bob" });
    expect(await statusOf(booted, id)).toBe("approved");
  });

  it("answers 404 to a caller with no role, as for a project that does not exist, and to an unknown build", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    // No role on the project: the answer for a project that does not exist (#497), not 403.
    expect((await give(booted, channel, id, { user: "outsider" })).status).toBe(404);
    expect((await give(booted, channel, "ghost", { user: "alice" })).status).toBe(404);
    expect(await statusOf(booted, id)).toBe("pending");
  });
});

describe.each(CHANNELS)("anonymous review through the %s (authentication off)", (channel) => {
  it("works with one required approval", async () => {
    const booted = await boot({ noAuth: true });
    const id = await createBuild(booted);
    const given = await give(booted, channel, id, { user: "nobody" });
    expect(given.status).toBeLessThan(400);
    expect(await statusOf(booted, id)).toBe("approved");
  });

  it("answers 409 with two required, and repeated verdicts never count twice", async () => {
    const booted = await boot({ noAuth: true, project: { reviewApprovals: 2 } });
    const id = await createBuild(booted);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose
      const refused = await give(booted, channel, id, { user: "nobody" });
      expect(refused.status).toBe(409);
      expect(refused.text).toContain("needs 2 approvals");
    }
    expect(await statusOf(booted, id)).toBe("pending");
    expect(await booted.db.list(booted.db.tables.buildReviews)).toHaveLength(0);
  });
});

describe.each(CHANNELS)("the publish guard through the %s", (channel) => {
  it("answers 409 while publishing, then takes the verdict", async () => {
    const booted = await boot();
    const id = await createBuild(booted, false);
    const early = await give(booted, channel, id, { user: "alice" });
    expect(early.status).toBe(409);
    expect(early.text).toContain("still publishing");
    expect(await statusOf(booted, id)).toBe("pending");
    await booted.storage.write(`${storybookDir("p1", id)}/manifest.json`, Buffer.from("{}"));
    expect((await give(booted, channel, id, { user: "alice" })).status).toBeLessThan(400);
    expect(await statusOf(booted, id)).toBe("approved");
  });

  it("answers 409 after a failed publish, and the page offers no form", async () => {
    const booted = await boot();
    const id = await createBuild(booted, false);
    await new BuildModel(booted.db).setStatus(id, "failed");
    const refused = await give(booted, channel, id, { user: "alice" });
    expect(refused.status).toBe(409);
    expect(refused.text).toContain("failed");
    expect(await page(booted, "alice", `/builds/${id}`)).not.toContain("Approve build");
  });
});

describe("the verdict form while publishing", () => {
  it("is rendered disabled with an explanation, and enabled once published", async () => {
    const booted = await boot();
    const id = await createBuild(booted, false);
    const waiting = await page(booted, "alice", `/builds/${id}`);
    expect(waiting).toContain("Waiting for the Storybook to publish");
    expect(waiting).toMatch(/<button[^>]*disabled[^>]*value="approved"/u);
    await booted.storage.write(`${storybookDir("p1", id)}/manifest.json`, Buffer.from("{}"));
    const ready = await page(booted, "alice", `/builds/${id}`);
    expect(ready).not.toContain("Waiting for the Storybook to publish");
    expect(ready).not.toMatch(/<button[^>]*disabled[^>]*value="approved"/u);
  });
});

/**
 * A runner that tells the test it has started rendering (`entered`), waits for `release`, then
 * reports its one story as failed to render.
 */
function failingRunner(release: Promise<null>) {
  const entered = Promise.withResolvers<null>();
  const runner: CaptureRunner = {
    metadata: { name: "failing", version: "0.0.0", kind: "stub", category: "capture-runner" },
    render: async () => {
      entered.resolve(null);
      await release;
      return {
        captures: [],
        failures: [{ storyId: "button--primary", viewportName: "default", error: "render failed" }],
      };
    },
    cancel: async () => {
      await Promise.resolve();
    },
  };
  return { runner, entered: entered.promise };
}

/** A build with one story, created and uploaded as a zip, so the capture runs. */
async function uploadStories(booted: Booted): Promise<string> {
  const created = await booted.app.request("/api/v1/projects/gate/builds", {
    method: "POST",
    headers: { cookie: "storyshelf_session=admin", "content-type": "application/json" },
    body: JSON.stringify({ gitSha: SHA, gitBranch: "feature/x" }),
  });
  const { build } = (await created.json()) as { build: { id: string } };
  const zip = new AdmZip();
  zip.addFile("iframe.html", Buffer.from("<html></html>"));
  const entry = { type: "story", id: "button--primary", name: "Primary", title: "Button" };
  zip.addFile(
    "index.json",
    Buffer.from(
      JSON.stringify({
        v: 5,
        entries: { "button--primary": { ...entry, importPath: "./Button.stories.tsx" } },
      }),
    ),
  );
  const upload = await booted.app.request(`/api/v1/projects/gate/builds/${build.id}/zip`, {
    method: "PUT",
    headers: { cookie: "storyshelf_session=admin", "content-type": "application/zip" },
    body: new Uint8Array(zip.toBuffer()),
  });
  expect(upload.status).toBe(202);
  return build.id;
}

describe.each(CHANNELS)("a sign-off on a failed build through the %s (testing on)", (channel) => {
  it("is refused and leaves the build failed, with no verdict stored", async () => {
    const booted = await boot({ testing: true });
    const id = await createBuild(booted);
    await new BuildModel(booted.db).setStatus(id, "failed");
    const given = await give(booted, channel, id, { user: "alice" });
    expect(given.status).toBe(409);
    expect(given.text).toContain("failed");
    expect(await statusOf(booted, id)).toBe("failed");
    expect(await new BuildReviewModel(booted.db).listByBuild(id)).toEqual([]);
  });

  it("given during the capture, does not turn failed snapshots into a pass", async () => {
    const release = Promise.withResolvers<null>();
    const failing = failingRunner(release.promise);
    const booted = await boot({ testing: true, runner: failing.runner });
    try {
      const id = await uploadStories(booted);
      // The capture is inside the runner, so a failure from here on is the render failure.
      await failing.entered;
      const given = await give(booted, channel, id, { user: "alice" });
      expect(given.status).toBeLessThan(400);
      release.resolve(null);
      await vi.waitFor(async () => expect(await statusOf(booted, id)).toBe("failed"));
      // The failure reached the rollup: the attempt closed with one failed story and no error of
      // its own (a capture that threw after the runner returned would also fail the build).
      await vi.waitFor(async () => {
        const attempts = await new CaptureAttemptModel(booted.db).listByBuild(id);
        expect(attempts).toMatchObject([{ failedCount: 1, error: null }]);
      });
      expect(await new BuildReviewModel(booted.db).listByBuild(id)).toHaveLength(1);
    } finally {
      release.resolve(null);
    }
  });
});

describe.each(CHANNELS)("sign-offs through the %s (testing on)", (channel) => {
  it("accepts a sign-off while the capture runs, and changes nothing else", async () => {
    const booted = await boot({ testing: true });
    const id = await createBuild(booted);
    await new BuildModel(booted.db).setStatus(id, "capturing");
    await booted.db.insert(booted.db.tables.baselines, {
      id: "bl1",
      projectId: "p1",
      storyId: "a--x",
      viewportName: "default",
      browser: "chromium",
      branch: "main",
      snapshotId: "s0",
      screenshotPath: "baselines/bl1.png",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const baselines = await booted.db.list(booted.db.tables.baselines);
    expect(baselines).toHaveLength(1);
    const given = await give(booted, channel, id, { user: "alice" });
    expect(given.status).toBeLessThan(400);
    expect(await statusOf(booted, id)).toBe("capturing");
    expect(await booted.db.list(booted.db.tables.baselines)).toEqual(baselines);
    expect(await page(booted, "alice", `/builds/${id}`)).toContain("sign-off");
  });

  it.each(["failed", "cancelled"] as const)("keeps a %s build non-reviewable", async (status) => {
    const booted = await boot({ testing: true });
    const id = await createBuild(booted);
    await new BuildModel(booted.db).setStatus(id, status);
    expect((await give(booted, channel, id, { user: "alice" })).status).toBe(409);
    expect(await statusOf(booted, id)).toBe(status);
    expect(await booted.db.list(booted.db.tables.buildReviews)).toHaveLength(0);
    // The build page says there is nothing to review, in words.
    const html = await page(booted, "alice", `/builds/${id}`);
    expect(html).toContain(
      `Nothing to review: this build ${status === "failed" ? "failed" : "was cancelled"}.`,
    );
    expect(html).not.toContain("approval given");
  });
});
