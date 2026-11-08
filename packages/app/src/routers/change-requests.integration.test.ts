import { BuildModel, CommentModel, MemberModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { ProjectRole } from "@storyshelf/core/types";
import { storybookDir } from "@storyshelf/core/utils";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubAuth } from "../stub-auth.ts";

/**
 * Change requests (ADR 0013): a comment that asks for a change, resolved and reopened by
 * developers and above and by the build's author. They never gate approval or change a status.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const ROLES: Record<string, ProjectRole> = {
  admin: "admin",
  alice: "approver",
  dev: "developer",
  view: "viewer",
  author: "viewer",
};
const users = [...Object.keys(ROLES), "outsider"].map((id) => ({
  id,
  email: `${id}@example.com`,
  name: id === "dev" ? "Dana Developer" : id,
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
const apps: { lifecycle: { teardown(): Promise<void> } }[] = [];
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-change-requests-"));
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
  await rm(scratchDir, { recursive: true, force: true });
});

async function boot(project: Record<string, unknown> = {}) {
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
    ...project,
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
    config: { secret: "s", scratchDir, publicBaseUrl: "https://shelf.example" },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  apps.push(app);
  return { app, db, storage };
}

type Booted = Awaited<ReturnType<typeof boot>>;
type Channel = "api" | "form";
const CHANNELS: Channel[] = ["api", "form"];

/** A published feature-branch build; its git author is `author@example.com`. */
async function createBuild(booted: Booted): Promise<string> {
  const created = await booted.app.request("/api/v1/projects/gate/builds", {
    method: "POST",
    headers: { cookie: "storyshelf_session=admin", "content-type": "application/json" },
    body: JSON.stringify({
      gitSha: "a".repeat(40),
      gitBranch: "feature/x",
      authorEmail: "Author@Example.com",
    }),
  });
  expect(created.status).toBe(202);
  const { build } = (await created.json()) as { build: { id: string } };
  await booted.storage.write(`${storybookDir("p1", build.id)}/iframe.html`, Buffer.from("<html>"));
  await booted.storage.write(`${storybookDir("p1", build.id)}/manifest.json`, Buffer.from("{}"));
  return build.id;
}

/** A call as `user`, through the JSON API or the browser form route. */
async function call(
  booted: Booted,
  channel: Channel,
  user: string,
  path: string,
  fields: Record<string, string> = {},
): Promise<{ status: number; json: () => Promise<Record<string, unknown>> }> {
  const form = channel === "form";
  const response = await booted.app.request(
    `${form ? "/projects/gate" : "/api/v1/projects/gate"}${path}`,
    {
      method: "POST",
      headers: {
        cookie: `storyshelf_session=${user}`,
        "x-csrf-token": getCsrfToken("s", user),
        "content-type": form ? "application/x-www-form-urlencoded" : "application/json",
      },
      body: form ? new URLSearchParams(fields).toString() : JSON.stringify(fields),
    },
  );
  return {
    status: response.status,
    json: async () => (await response.json()) as Record<string, unknown>,
  };
}

/** A request for change by `dev`, made straight in the database. */
async function makeRequest(booted: Booted, id: string, extra: Record<string, string> = {}) {
  return await new CommentModel(booted.db).create("p1", id, "dev", {
    body: "Fix the padding",
    kind: "change_request",
    ...extra,
  });
}

async function buildPage(booted: Booted, user: string, id: string): Promise<string> {
  const response = await booted.app.request(`/projects/gate/builds/${id}`, {
    headers: { cookie: `storyshelf_session=${user}` },
  });
  expect(response.status).toBe(200);
  return await response.text();
}

const statusOf = async (booted: Booted, id: string) =>
  (await new BuildModel(booted.db).get(id))?.status;

/** The fields of a comment, a change request when `kind` says so. */
const fields = (kind?: string) => ({ body: "Looks off", ...(kind ? { kind } : {}) });

describe.each(CHANNELS)("making a change request through the %s", (channel) => {
  it("stores the kind, defaults to a plain comment, and refuses a viewer", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    expect(
      (await call(booted, channel, "dev", `/builds/${id}/comments`, fields("change_request")))
        .status,
    ).toBeLessThan(400);
    expect(
      (await call(booted, channel, "dev", `/builds/${id}/comments`, fields())).status,
    ).toBeLessThan(400);
    const kinds = (await new CommentModel(booted.db).listByBuild(id))
      .map((comment) => comment.kind)
      .toSorted();
    expect(kinds).toEqual(["change_request", "comment"]);
    const refused = await call(
      booted,
      channel,
      "view",
      `/builds/${id}/comments`,
      fields("change_request"),
    );
    expect(refused.status).toBe(403);
    expect(await new CommentModel(booted.db).listByBuild(id)).toHaveLength(2);
  });
});

describe.each(CHANNELS)("resolving and reopening through the %s", (channel) => {
  it("lets a developer resolve and reopen, recording who and when", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    const item = await makeRequest(booted, id);
    expect(
      (await call(booted, channel, "dev", `/builds/${id}/comments/${item.id}/resolve`)).status,
    ).toBeLessThan(400);
    const resolved = await new CommentModel(booted.db).get(item.id);
    expect(resolved).toMatchObject({ resolved: true, resolvedBy: "dev", kind: "change_request" });
    expect(resolved?.resolvedAt).toBeTruthy();
    expect(
      (await call(booted, channel, "alice", `/builds/${id}/comments/${item.id}/reopen`)).status,
    ).toBeLessThan(400);
    expect(await new CommentModel(booted.db).get(item.id)).toMatchObject({
      resolved: false,
      resolvedAt: null,
      resolvedBy: null,
    });
  });

  it("refuses a viewer and a non-member with 403, and changes nothing", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    const item = await makeRequest(booted, id);
    for (const user of ["view", "outsider"]) {
      for (const verb of ["resolve", "reopen"]) {
        // eslint-disable-next-line no-await-in-loop -- few calls
        const refused = await call(
          booted,
          channel,
          user,
          `/builds/${id}/comments/${item.id}/${verb}`,
        );
        expect(refused.status, `${user} ${verb}`).toBe(403);
      }
    }
    expect((await new CommentModel(booted.db).get(item.id))?.resolved).toBe(false);
  });

  it("lets the build's own author resolve and reopen, though they only view the project", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    const item = await makeRequest(booted, id);
    expect(
      (await call(booted, channel, "author", `/builds/${id}/comments/${item.id}/resolve`)).status,
    ).toBeLessThan(400);
    expect((await new CommentModel(booted.db).get(item.id))?.resolvedBy).toBe("author");
    expect(
      (await call(booted, channel, "author", `/builds/${id}/comments/${item.id}/reopen`)).status,
    ).toBeLessThan(400);
  });

  it("answers 404 for an unknown comment and for one of another build", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    const other = await createBuild(booted);
    const item = await makeRequest(booted, other);
    expect((await call(booted, channel, "dev", `/builds/${id}/comments/nope/resolve`)).status).toBe(
      404,
    );
    expect(
      (await call(booted, channel, "dev", `/builds/${id}/comments/${item.id}/reopen`)).status,
    ).toBe(404);
  });
});

describe("the change-request checklist", () => {
  it("counts the open requests in the header and links each to its anchor", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    const onBuild = await makeRequest(booted, id, { body: "Missing dark mode" });
    const onStory = await makeRequest(booted, id, {
      body: "Padding looks off",
      storyId: "button--primary",
    });
    const onSnapshot = await makeRequest(booted, id, { body: "Wrong colour", snapshotId: "snap1" });
    await new CommentModel(booted.db).create("p1", id, "dev", { body: "Just a note" });
    const html = await buildPage(booted, "alice", id);
    expect(html).toContain("3 open change requests");
    expect(html).toContain("Change requests");
    expect(html).toContain(`href="#comment-${onBuild.id}"`);
    expect(html).toContain(`href="#comment-${onStory.id}"`);
    expect(html).toContain(`/builds/${id}/diff?snapshot=snap1#comment-${onSnapshot.id}`);
    expect(html).toContain(`id="comment-${onBuild.id}"`);
    expect(html).toContain("Build: Missing dark mode");
    expect(html).toContain("button--primary: Padding looks off");
  });

  it("folds a resolved request away, says who resolved it, and counts only the open ones", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    const first = await makeRequest(booted, id, { body: "First" });
    await makeRequest(booted, id, { body: "Second" });
    await new CommentModel(booted.db).resolve(first.id, "dev");
    const html = await buildPage(booted, "alice", id);
    expect(html).toContain("1 open change request<");
    expect(html).toContain("Resolved (1)");
    expect(html).toContain("Resolved by Dana Developer");
  });

  it("shows nothing when there are none, or when all are resolved", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    const none = await buildPage(booted, "alice", id);
    expect(none).not.toContain("open change request");
    expect(none).not.toContain("Change requests");
    const item = await makeRequest(booted, id);
    await new CommentModel(booted.db).resolve(item.id, "dev");
    const done = await buildPage(booted, "alice", id);
    expect(done).not.toContain("open change request");
    expect(done).toContain("All change requests are resolved.");
  });

  it("offers resolve and reopen to those who may triage, and only state to viewers", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    const item = await makeRequest(booted, id);
    const dev = await buildPage(booted, "dev", id);
    expect(dev).toContain(`/comments/${item.id}/resolve`);
    expect(dev).toContain("Change requested");
    const viewer = await buildPage(booted, "view", id);
    expect(viewer).toContain("Change requested");
    expect(viewer).not.toContain(`/comments/${item.id}/resolve`);
    const author = await buildPage(booted, "author", id);
    expect(author).toContain(`/comments/${item.id}/resolve`);
    await new CommentModel(booted.db).resolve(item.id, "dev");
    expect(await buildPage(booted, "dev", id)).toContain(`/comments/${item.id}/reopen`);
  });

  it("adds a 'Request a change' box to the build comment form", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    const html = await buildPage(booted, "dev", id);
    expect(html).toContain("Request a change");
    expect(html).toContain('value="change_request"');
  });
});

describe("open change requests do not gate approval", () => {
  it("asks before approving, but the approval still succeeds and nothing else moves", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    await makeRequest(booted, id);
    await makeRequest(booted, id, { storyId: "button--primary" });
    const html = await buildPage(booted, "alice", id);
    expect(html).toContain('hx-confirm="There are 2 open change requests. Approve anyway?"');
    // Only the Approve button asks: the Reject button carries no confirmation.
    expect(html.match(/hx-confirm="There are/gu)).toHaveLength(1);

    expect(await statusOf(booted, id)).toBe("pending");
    const approved = await call(booted, "api", "alice", `/builds/${id}/reviews`, {
      verdict: "approved",
    });
    expect(approved.status).toBe(201);
    expect(await statusOf(booted, id)).toBe("approved");
  });

  it("asks nothing when no request is open, and singular for one", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    expect(await buildPage(booted, "alice", id)).not.toContain("hx-confirm");
    await makeRequest(booted, id);
    expect(await buildPage(booted, "alice", id)).toContain(
      "There are 1 open change request. Approve anyway?",
    );
  });

  it("changes no status when requests are made, resolved or reopened", async () => {
    const booted = await boot();
    const id = await createBuild(booted);
    const before = await statusOf(booted, id);
    const made = await call(booted, "api", "dev", `/builds/${id}/comments`, {
      body: "Please fix",
      kind: "change_request",
    });
    const { id: commentId } = (await made.json()) as { id: string };
    await call(booted, "api", "dev", `/builds/${id}/comments/${commentId}/resolve`);
    await call(booted, "api", "dev", `/builds/${id}/comments/${commentId}/reopen`);
    expect(await statusOf(booted, id)).toBe(before);
    const reviews = await booted.app.request(`/api/v1/projects/gate/builds/${id}/reviews`, {
      headers: { cookie: "storyshelf_session=alice" },
    });
    expect(await reviews.json()).toMatchObject({ approvals: 0 });
  });
});
