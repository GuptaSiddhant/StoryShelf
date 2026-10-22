import { BuildModel, MemberModel, ProjectModel, TokenModel } from "@storyshelf/core/models";
import { makeDatabase, makeFakeStateNotifier, makeStorage } from "@storyshelf/core/test-helpers";
import type { ProjectRole } from "@storyshelf/core/types";
import { sha256, storybookDir } from "@storyshelf/core/utils";
import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

/**
 * Build-level verdicts (ADR 0013, decision 3) on a hosting-only instance: the verdicts decide a
 * non-default build, the default branch is never held, and `<prefix>/review` and
 * `<prefix>/storybook` follow the build (decision 5).
 */

const SHA = "c".repeat(40);
const NOW = "2026-01-01T00:00:00.000Z";
const ROLES: Record<string, ProjectRole> = {
  admin: "admin",
  alice: "approver",
  bob: "approver",
  dev: "developer",
  view: "viewer",
};

const users = Object.keys(ROLES).map((id) => ({
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
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-review-"));
});
afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

function storybookZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile("iframe.html", Buffer.from("<html></html>"));
  zip.addFile(
    "index.json",
    Buffer.from(
      JSON.stringify({
        v: 5,
        entries: {
          "a--x": { type: "story", id: "a--x", title: "A", name: "X", importPath: "./A.tsx" },
        },
      }),
    ),
  );
  return zip.toBuffer();
}

async function boot(
  options: { testing?: boolean; noAuth?: boolean; project?: Record<string, unknown> } = {},
) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const git = makeFakeStateNotifier("fake-host");
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
    ...(options.testing === true ? { testing: { runner: stubRunner() } } : {}),
    config: {
      secret: "s",
      scratchDir,
      publicBaseUrl: "https://shelf.example",
      adminToken: "root-token",
    },
    notifications: { notifiers: [git.provider] },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  const as =
    (id: string) =>
    async (path: string, init: { method?: string; body?: string } = {}) =>
      await app.request(`/api/v1/projects/gate${path}`, {
        ...init,
        headers: {
          cookie: `storyshelf_session=${id}`,
          "content-type": "application/json",
        },
      });
  const channel = await as("admin")("/notification-channels", {
    method: "POST",
    body: JSON.stringify({ provider: "fake-host", config: { owner: "a", repo: "w" }, secret: "t" }),
  });
  expect(channel.status).toBe(201);
  const statuses = (context: string): string[] =>
    git.calls.flatMap((call) =>
      call.target.kind === "status" && call.target.context === context ? [call.state] : [],
    );
  const descriptions = (context: string): string[] =>
    git.calls.flatMap((call) =>
      call.target.kind === "status" && call.target.context === context
        ? [call.target.description ?? ""]
        : [],
    );
  return { app, db, storage, as, statuses, descriptions };
}

type Booted = Awaited<ReturnType<typeof boot>>;

/** A published build on `branch`, through the API as CI does it. */
async function publish(booted: Booted, branch: string): Promise<string> {
  const created = await booted.as("dev")("/builds", {
    method: "POST",
    body: JSON.stringify({ gitSha: SHA, gitBranch: branch }),
  });
  expect(created.status).toBe(202);
  const { build } = (await created.json()) as { build: { id: string } };
  const upload = await booted.app.request(`/api/v1/projects/gate/builds/${build.id}/zip`, {
    method: "PUT",
    headers: { cookie: "storyshelf_session=dev", "content-type": "application/zip" },
    body: new Uint8Array(storybookZip()),
  });
  expect(upload.status).toBe(202);
  return build.id;
}

const verdict = (value: "approved" | "rejected", body?: string) =>
  ({ method: "POST", body: JSON.stringify({ verdict: value, body }) }) satisfies RequestInit;

async function statusOf(booted: Booted, id: string): Promise<string | undefined> {
  return (await new BuildModel(booted.db).get(id))?.status;
}

describe("hosting-only review", () => {
  it("holds a PR build until an approver approves, and posts the review and storybook statuses", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    expect(await statusOf(booted, id)).toBe("pending");
    await vi.waitFor(() => {
      const review = booted.statuses("storyshelf/review");
      expect(review.length).toBeGreaterThan(0);
      expect(review.every((state) => state === "pending")).toBe(true);
      expect(booted.statuses("storyshelf/storybook").at(-1)).toBe("success");
    });

    const given = await booted.as("alice")(`/builds/${id}/reviews`, verdict("approved", "ship it"));
    expect(given.status).toBe(201);
    expect(await given.json()).toMatchObject({
      userId: "alice",
      verdict: "approved",
      body: "ship it",
    });

    expect(await statusOf(booted, id)).toBe("approved");
    await vi.waitFor(() => {
      expect(booted.statuses("storyshelf/review").at(-1)).toBe("success");
    });
    await booted.app.lifecycle.teardown();
  });

  it("never holds the default branch, and posts it as approved", async () => {
    const booted = await boot();
    const id = await publish(booted, "main");
    expect(await statusOf(booted, id)).toBe("approved");
    await vi.waitFor(() => {
      expect(booted.statuses("storyshelf/review").at(-1)).toBe("success");
    });
    await booted.app.lifecycle.teardown();
  });

  it("rejects on any rejection, and a rewritten verdict flips the build back", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    await booted.as("alice")(`/builds/${id}/reviews`, verdict("approved"));
    await booted.as("bob")(`/builds/${id}/reviews`, verdict("rejected", "needs work"));
    expect(await statusOf(booted, id)).toBe("rejected");
    await vi.waitFor(() => {
      expect(booted.statuses("storyshelf/review").at(-1)).toBe("failure");
    });

    await booted.as("bob")(`/builds/${id}/reviews`, verdict("approved"));
    expect(await statusOf(booted, id)).toBe("approved");
    await vi.waitFor(() => {
      expect(booted.statuses("storyshelf/review").at(-1)).toBe("success");
    });
    await booted.app.lifecycle.teardown();
  });

  it("needs the project's required approvals, counting a reviewer once", async () => {
    const booted = await boot({ project: { reviewApprovals: 2 } });
    const id = await publish(booted, "feature/x");
    await booted.as("alice")(`/builds/${id}/reviews`, verdict("approved"));
    await booted.as("alice")(`/builds/${id}/reviews`, verdict("approved"));
    expect(await statusOf(booted, id)).toBe("pending");
    await booted.as("bob")(`/builds/${id}/reviews`, verdict("approved"));
    expect(await statusOf(booted, id)).toBe("approved");

    const state = await (await booted.as("view")(`/builds/${id}/reviews`)).json();
    expect(state).toMatchObject({ status: "approved", approvalsRequired: 2, approvals: 2 });
    expect((state as { history: unknown[] }).history).toHaveLength(3);

    await booted.as("alice")(`/builds/${id}/reviews`, verdict("rejected"));
    expect(await statusOf(booted, id)).toBe("rejected");
    await booted.app.lifecycle.teardown();
  });

  it("sends a rejected build back to pending when the rewrite leaves too few approvals", async () => {
    const booted = await boot({ project: { reviewApprovals: 2 } });
    const id = await publish(booted, "feature/x");
    await booted.as("bob")(`/builds/${id}/reviews`, verdict("rejected"));
    expect(await statusOf(booted, id)).toBe("rejected");
    await booted.as("bob")(`/builds/${id}/reviews`, verdict("approved"));
    expect(await statusOf(booted, id)).toBe("pending");
    await vi.waitFor(() => {
      expect(booted.statuses("storyshelf/review").at(-1)).toBe("pending");
    });
    await booted.app.lifecycle.teardown();
  });

  it("lets developers and viewers read at most: only approvers and admins give verdicts", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    expect((await booted.as("dev")(`/builds/${id}/reviews`, verdict("approved"))).status).toBe(403);
    expect((await booted.as("view")(`/builds/${id}/reviews`, verdict("approved"))).status).toBe(
      403,
    );
    expect((await booted.as("dev")(`/builds/${id}/reviews`)).status).toBe(200);
    expect((await booted.as("view")(`/builds/${id}/reviews`)).status).toBe(200);
    expect((await booted.as("admin")(`/builds/${id}/reviews`, verdict("approved"))).status).toBe(
      201,
    );
    expect(await statusOf(booted, id)).toBe("approved");
    await booted.app.lifecycle.teardown();
  });

  it("answers 404 for every verdict route when the project has review off", async () => {
    const booted = await boot({ project: { reviewEnabled: false } });
    const id = await publish(booted, "feature/x");
    expect(await statusOf(booted, id)).toBe("approved");
    expect((await booted.as("alice")(`/builds/${id}/reviews`, verdict("rejected"))).status).toBe(
      404,
    );
    expect((await booted.as("alice")(`/builds/${id}/reviews`)).status).toBe(404);
    expect(await statusOf(booted, id)).toBe("approved");
    await vi.waitFor(() => {
      expect(booted.statuses("storyshelf/storybook").at(-1)).toBe("success");
    });
    // Review was never on, so the one status is the closing success (no pending one to clear).
    expect(booted.statuses("storyshelf/review")).toEqual(["success"]);
    await booted.app.lifecycle.teardown();
  });

  it("accepts a non-default build without an approval event when review is switched off", async () => {
    const booted = await boot();
    await new ProjectModel(booted.db).update("p1", { reviewEnabled: false });
    const id = await publish(booted, "feature/y");
    expect(await statusOf(booted, id)).toBe("approved");
    await booted.app.lifecycle.teardown();
  });

  it("404s a build of another project and 409s a failed build", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    expect((await booted.as("alice")("/builds/ghost/reviews", verdict("approved"))).status).toBe(
      404,
    );
    await new BuildModel(booted.db).setStatus(id, "failed");
    expect((await booted.as("alice")(`/builds/${id}/reviews`, verdict("approved"))).status).toBe(
      409,
    );
    expect(await statusOf(booted, id)).toBe("failed");
    await booted.app.lifecycle.teardown();
  });
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function bearerVerdict(booted: Booted, id: string, token: string): Promise<Response> {
  return await booted.app.request(`/api/v1/projects/gate/builds/${id}/reviews`, {
    method: "POST",
    headers: { ...bearer(token), "content-type": "application/json" },
    body: JSON.stringify({ verdict: "approved" }),
  });
}

describe("who gave the verdict", () => {
  it("attributes a token's verdict to the user who owns the token", async () => {
    const booted = await boot({ project: { reviewApprovals: 2 } });
    const id = await publish(booted, "feature/x");
    await new TokenModel(booted.db).create("p1", {
      name: "alice-ci",
      hash: sha256("alice-token"),
      userId: "alice",
    });
    const given = await bearerVerdict(booted, id, "alice-token");
    expect(given.status).toBe(201);
    expect(await given.json()).toMatchObject({ userId: "alice" });
    // The token's owner is one reviewer: the same user by session adds no second approval.
    await booted.as("alice")(`/builds/${id}/reviews`, verdict("approved"));
    expect(await statusOf(booted, id)).toBe("pending");
    await booted.as("bob")(`/builds/${id}/reviews`, verdict("approved"));
    expect(await statusOf(booted, id)).toBe("approved");
    await booted.app.lifecycle.teardown();
  });

  it("refuses a verdict that cannot be traced to a user", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    const adminToken = await bearerVerdict(booted, id, "root-token");
    expect(adminToken.status).toBe(403);
    expect(await adminToken.text()).toContain("needs a user");
    await new TokenModel(booted.db).create("p1", {
      name: "ownerless",
      hash: sha256("ownerless-token"),
      userId: null,
    });
    expect((await bearerVerdict(booted, id, "ownerless-token")).status).toBe(403);
    expect((await bearerVerdict(booted, id, "unknown-token")).status).toBe(401);
    expect(await statusOf(booted, id)).toBe("pending");
    await booted.app.lifecycle.teardown();
  });

  it("records one anonymous reviewer only when the instance has no authentication", async () => {
    const booted = await boot({ noAuth: true });
    const id = await publish(booted, "feature/x");
    const given = await booted.as("nobody")(`/builds/${id}/reviews`, verdict("approved"));
    expect(given.status).toBe(201);
    expect(await given.json()).toMatchObject({ userId: null });
    expect(await statusOf(booted, id)).toBe("approved");
    await booted.app.lifecycle.teardown();
  });

  it("answers 409 to an anonymous verdict when the project needs several approvals", async () => {
    const booted = await boot({ noAuth: true, project: { reviewApprovals: 2 } });
    const id = await publish(booted, "feature/x");
    const refused = await booted.as("nobody")(`/builds/${id}/reviews`, verdict("approved"));
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("needs 2 approvals");
    expect(await statusOf(booted, id)).toBe("pending");
    await booted.app.lifecycle.teardown();
  });
});

describe("a verdict waits for publishing", () => {
  it("answers 409 until the Storybook is published, then takes the verdict", async () => {
    const booted = await boot();
    const created = await booted.as("dev")("/builds", {
      method: "POST",
      body: JSON.stringify({ gitSha: SHA, gitBranch: "feature/x" }),
    });
    const { build } = (await created.json()) as { build: { id: string } };
    const early = await booted.as("alice")(`/builds/${build.id}/reviews`, verdict("approved"));
    expect(early.status).toBe(409);
    expect(await early.text()).toContain("still publishing");
    expect(await statusOf(booted, build.id)).toBe("pending");
    expect((await new BuildModel(booted.db).get(build.id))?.status).toBe("pending");

    await booted.storage.write(`${storybookDir("p1", build.id)}/manifest.json`, Buffer.from("{}"));
    const late = await booted.as("alice")(`/builds/${build.id}/reviews`, verdict("approved"));
    expect(late.status).toBe(201);
    expect(await statusOf(booted, build.id)).toBe("approved");
    await booted.app.lifecycle.teardown();
  });
});

describe("review progress and switch-off on the git host", () => {
  it("shows approval progress on <prefix>/review", async () => {
    const booted = await boot({ project: { reviewApprovals: 2 } });
    const id = await publish(booted, "feature/x");
    await booted.as("alice")(`/builds/${id}/reviews`, verdict("approved"));
    await vi.waitFor(() => {
      expect(booted.descriptions("storyshelf/review").at(-1)).toBe("Waiting for approvals: 1 of 2");
    });
    await booted.app.lifecycle.teardown();
  });

  it("clears the pending review status when review is switched off", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    await vi.waitFor(() => {
      expect(booted.statuses("storyshelf/review").at(-1)).toBe("pending");
    });
    const off = await booted.as("admin")("", {
      method: "PATCH",
      body: JSON.stringify({ reviewEnabled: false }),
    });
    expect(off.status).toBe(200);
    expect(await statusOf(booted, id)).toBe("approved");
    await vi.waitFor(() => {
      expect(booted.statuses("storyshelf/review").at(-1)).toBe("success");
      expect(booted.descriptions("storyshelf/review").at(-1)).toBe("Review is off");
    });
    await booted.app.lifecycle.teardown();
  });
});

describe("review with testing on", () => {
  it("stores the verdict as a sign-off and leaves the status to the snapshots", async () => {
    const booted = await boot({ testing: true });
    const created = await booted.as("dev")("/builds", {
      method: "POST",
      body: JSON.stringify({ gitSha: SHA, gitBranch: "feature/z" }),
    });
    const { build } = (await created.json()) as { build: { id: string; status: string } };
    await booted.storage.write(`${storybookDir("p1", build.id)}/manifest.json`, Buffer.from("{}"));
    const before = await statusOf(booted, build.id);
    const given = await booted.as("alice")(`/builds/${build.id}/reviews`, verdict("approved"));
    expect(given.status).toBe(201);
    expect(await statusOf(booted, build.id)).toBe(before);
    const state = await (await booted.as("alice")(`/builds/${build.id}/reviews`)).json();
    expect(state).toMatchObject({ approvals: 1 });
    await booted.app.lifecycle.teardown();
  });
});
