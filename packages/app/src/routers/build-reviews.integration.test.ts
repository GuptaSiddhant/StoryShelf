import { BuildModel, MemberModel, ProjectModel } from "@storyshelf/core/models";
import { makeDatabase, makeFakeStateNotifier, makeStorage } from "@storyshelf/core/test-helpers";
import type { ProjectRole } from "@storyshelf/core/types";
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

async function boot(options: { testing?: boolean; project?: Record<string, unknown> } = {}) {
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
    auth,
    ...(options.testing === true ? { testing: { runner: stubRunner() } } : {}),
    config: { secret: "s", scratchDir, publicBaseUrl: "https://shelf.example" },
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
  return { app, db, as, statuses };
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
    expect(booted.statuses("storyshelf/review")).toEqual([]);
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

describe("review with testing on", () => {
  it("stores the verdict as a sign-off and leaves the status to the snapshots", async () => {
    const booted = await boot({ testing: true });
    const created = await booted.as("dev")("/builds", {
      method: "POST",
      body: JSON.stringify({ gitSha: SHA, gitBranch: "feature/z" }),
    });
    const { build } = (await created.json()) as { build: { id: string; status: string } };
    const before = await statusOf(booted, build.id);
    const given = await booted.as("alice")(`/builds/${build.id}/reviews`, verdict("approved"));
    expect(given.status).toBe(201);
    expect(await statusOf(booted, build.id)).toBe(before);
    const state = await (await booted.as("alice")(`/builds/${build.id}/reviews`)).json();
    expect(state).toMatchObject({ approvals: 1 });
    await booted.app.lifecycle.teardown();
  });
});
