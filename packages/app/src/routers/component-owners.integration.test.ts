import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import {
  BuildModel,
  MemberModel,
  NotificationSubscriptionModel,
  ProjectModel,
  readOwnerRules,
} from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { ProjectRole } from "@storyshelf/core/types";
import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubAuth } from "../stub-auth.ts";

/**
 * Reviewers assigned from component ownership (#465): the admin-only editor on the Members tab,
 * the review request that goes to the owners of a build's changed components, the build page row,
 * and the approval rules, which do not read any of it.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const ROLES: Record<string, ProjectRole> = {
  boss: "admin",
  alice: "approver",
  bob: "approver",
  dev: "developer",
  view: "viewer",
};
const users = [...Object.keys(ROLES), "outsider"].map((id) => ({
  id,
  email: `${id}@example.com`,
  name: id === "alice" ? "Alice Reviewer" : id,
  role: "member" as const,
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
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-owners-"));
});
afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

const STORIES = {
  "button--primary": { title: "Button", importPath: "./src/forms/Button.stories.tsx" },
  "chart--bar": { title: "Chart", importPath: "./src/charts/Chart.stories.tsx" },
};

function storybookZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile("iframe.html", Buffer.from("<html></html>"));
  const entries = Object.fromEntries(
    Object.entries(STORIES).map(([id, story]) => [
      id,
      { type: "story", id, name: "Story", ...story },
    ]),
  );
  zip.addFile("index.json", Buffer.from(JSON.stringify({ v: 5, entries })));
  return zip.toBuffer();
}

/** One email as the recorder saw it. */
interface Mail {
  to: string;
  text: string;
}

async function boot(project: Record<string, unknown> = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const mails: Mail[] = [];
  const metadata = {
    name: "email",
    version: "0.0.0",
    kind: "email",
    category: "notifier" as const,
    schema: z.object({}).loose(),
  };
  const email: NotifierProvider = {
    metadata,
    create: () => ({
      metadata,
      // oxlint-disable-next-line eslint/require-await -- send is async by contract
      send: async (input: unknown) => {
        const sent = input as { channel: { config: { to: string } }; formatted: { text: string } };
        mails.push({ to: sent.channel.config.to, text: sent.formatted.text });
      },
    }),
  };
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Owners",
    slug: "owners",
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
    Object.entries(ROLES).map(async ([id, role]) => await new MemberModel(db).set("p1", id, role)),
  );
  const app = createShelfApp({
    database: db,
    storage,
    auth,
    config: { secret: "s", scratchDir, publicBaseUrl: "https://shelf.example" },
    notifications: { notifiers: [email] },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  const call = async (id: string, path: string, init: RequestInit = {}) =>
    await app.request(path, {
      ...init,
      headers: {
        cookie: `storyshelf_session=${id}`,
        "x-csrf-token": getCsrfToken("s", id),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  return { app, db, mails, call, stop: async () => await app.lifecycle.teardown() };
}

type Booted = Awaited<ReturnType<typeof boot>>;

/** Save the owners text as `id` (the Members tab form). */
async function saveOwners(booted: Booted, id: string, owners: string): Promise<Response> {
  return await booted.call(id, "/projects/owners/settings/members/owners", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "hx-request": "true" },
    body: new URLSearchParams({ owners }).toString(),
  });
}

/** Publish a build on a feature branch, so it waits for review. */
async function publish(booted: Booted, sha = "a".repeat(40)): Promise<string> {
  const created = await booted.call("dev", "/api/v1/projects/owners/builds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gitSha: sha, gitBranch: "feature/x" }),
  });
  const { build } = (await created.json()) as { build: { id: string } };
  const upload = await booted.call("dev", `/api/v1/projects/owners/builds/${build.id}/zip`, {
    method: "PUT",
    headers: { "content-type": "application/zip" },
    body: new Uint8Array(storybookZip()),
  });
  expect(upload.status).toBe(202);
  return build.id;
}

const storedRules = async (booted: Booted) =>
  readOwnerRules((await new ProjectModel(booted.db).get("p1"))?.componentOwners);

describe("the owners editor", () => {
  it("lets a project admin save rules and shows them back", async () => {
    const booted = await boot();
    const saved = await saveOwners(
      booted,
      "boss",
      "# forms\n./src/forms/**  dev @alice\nsrc/charts/**  bob",
    );
    expect(saved.status).toBe(204);
    expect(saved.headers.get("HX-Redirect")).toBe("/projects/owners/settings/members");
    expect(await storedRules(booted)).toEqual([
      { pattern: "./src/forms/**", owners: ["dev", "alice"] },
      { pattern: "src/charts/**", owners: ["bob"] },
    ]);
    const page = await (await booted.call("boss", "/projects/owners/settings/members")).text();
    expect(page).toContain("Component owners");
    expect(page).toContain("Save owners");
    expect(page).toContain("./src/forms/**  dev  alice");
    await booted.stop();
  });

  it("refuses a non-member and an empty rule line by line, saving nothing and keeping the text", async () => {
    const booted = await boot({
      componentOwners: JSON.stringify([{ pattern: "keep/**", owners: ["bob"] }]),
    });
    const text = "src/forms/** dev\nsrc/charts/** ghost\nsrc/empty/**";
    const refused = await saveOwners(booted, "boss", text);
    expect(refused.status).toBe(400);
    const html = await refused.text();
    expect(html).toContain("Couldn&#39;t save the owners");
    expect(html).toContain("Line 2: `ghost` is not a member of this project.");
    expect(html).toContain("Line 3: no owners listed.");
    expect(html).toContain("src/charts/** ghost");
    expect(await storedRules(booted)).toEqual([{ pattern: "keep/**", owners: ["bob"] }]);
    await booted.stop();
  });

  it("clears the map when the text is emptied", async () => {
    const booted = await boot({
      componentOwners: JSON.stringify([{ pattern: "a/**", owners: ["bob"] }]),
    });
    expect((await saveOwners(booted, "boss", "  \n# nothing\n")).status).toBe(204);
    expect(await storedRules(booted)).toEqual([]);
    await booted.stop();
  });

  it("answers 403 to everyone below admin, saving nothing, and shows them the rules read-only", async () => {
    const booted = await boot({
      componentOwners: JSON.stringify([{ pattern: "a/**", owners: ["bob"] }]),
    });
    for (const id of ["alice", "dev", "view"]) {
      // eslint-disable-next-line no-await-in-loop -- few users
      expect((await saveOwners(booted, id, "a/** dev")).status, id).toBe(403);
    }
    expect(await storedRules(booted)).toEqual([{ pattern: "a/**", owners: ["bob"] }]);
    const html = await (await booted.call("alice", "/projects/owners/settings/members")).text();
    expect(html).toContain("Only project admins can change this.");
    expect(html).toContain("<code>a/**</code>");
    expect(html).not.toContain("Save owners");
    await booted.stop();
  });

  it("answers 404 while review is off, and hides the card", async () => {
    const booted = await boot({ reviewEnabled: false });
    expect((await saveOwners(booted, "boss", "a/** bob")).status).toBe(404);
    const html = await (await booted.call("boss", "/projects/owners/settings/members")).text();
    expect(html).not.toContain("Component owners");
    await booted.stop();
  });
});

describe("the review request", () => {
  const mailsTo = (booted: Booted, id: string): Mail[] =>
    booted.mails.filter((mail) => mail.to === `${id}@example.com`);

  async function requested(booted: Booted): Promise<void> {
    await publish(booted);
    await vi.waitFor(() => expect(booted.mails.length).toBeGreaterThan(0));
  }

  it("goes to the owners of the changed components, once each, with the reason", async () => {
    const booted = await boot({
      componentOwners: JSON.stringify([
        { pattern: "src/forms/**", owners: ["dev", "alice"] },
        { pattern: "src/forms/Button.stories.tsx", owners: ["dev"] },
      ]),
    });
    await requested(booted);
    // dev is no default reviewer; alice and bob are. alice is assigned, so she gets the assigned
    // message instead of the default one; bob gets the ordinary one.
    expect(mailsTo(booted, "dev")).toHaveLength(1);
    expect(mailsTo(booted, "dev")[0]?.text).toContain(
      "You were asked to review this because you own Button.",
    );
    expect(mailsTo(booted, "alice")).toHaveLength(1);
    expect(mailsTo(booted, "alice")[0]?.text).toContain("you own Button");
    expect(mailsTo(booted, "bob")).toHaveLength(1);
    expect(mailsTo(booted, "bob")[0]?.text).not.toContain("you own");
    expect(mailsTo(booted, "view")).toEqual([]);
    await booted.stop();
  });

  it("reaches an assigned owner who opted out of the default email", async () => {
    const booted = await boot({
      componentOwners: JSON.stringify([{ pattern: "src/charts/**", owners: ["bob"] }]),
    });
    await new NotificationSubscriptionModel(booted.db).upsert("p1", "bob", { enabled: false });
    await requested(booted);
    expect(mailsTo(booted, "bob")).toHaveLength(1);
    expect(mailsTo(booted, "bob")[0]?.text).toContain("you own Chart");
    await booted.stop();
  });

  it("falls back to the default approvers when no changed component has an owner", async () => {
    const booted = await boot({
      componentOwners: JSON.stringify([{ pattern: "src/other/**", owners: ["dev"] }]),
    });
    await requested(booted);
    expect(booted.mails.map((mail) => mail.to).toSorted()).toEqual([
      "alice@example.com",
      "bob@example.com",
      "boss@example.com",
    ]);
    expect(booted.mails.every((mail) => !mail.text.includes("you own"))).toBe(true);
    await booted.stop();
  });

  it("leaves out an owner who is no longer a member", async () => {
    const booted = await boot({
      componentOwners: JSON.stringify([{ pattern: "src/forms/**", owners: ["dev", "gone"] }]),
    });
    await requested(booted);
    expect(mailsTo(booted, "dev")).toHaveLength(1);
    expect(booted.mails.some((mail) => mail.to.startsWith("gone"))).toBe(false);
    await booted.stop();
  });
});

describe("the build page and the approval rules", () => {
  it("lists the assigned reviewers with where they stand, and changes no count", async () => {
    const booted = await boot({
      componentOwners: JSON.stringify([{ pattern: "src/forms/**", owners: ["alice", "dev"] }]),
    });
    const id = await publish(booted);
    await vi.waitFor(() => expect(booted.mails.length).toBeGreaterThan(0));
    const before = await (await booted.call("bob", `/projects/owners/builds/${id}`)).text();
    expect(before).toContain("Assigned reviewers");
    expect(before).toContain(
      "Assigned from component owners. Anyone who can approve may still approve.",
    );
    expect(before).toContain("Waiting");
    // bob is not assigned and his approval alone satisfies the single approval the project needs.
    const verdict = await booted.call("bob", `/api/v1/projects/owners/builds/${id}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict: "approved" }),
    });
    expect(verdict.status).toBe(201);
    expect((await new BuildModel(booted.db).get(id))?.status).toBe("approved");
    await booted.call("alice", `/api/v1/projects/owners/builds/${id}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict: "approved" }),
    });
    const after = await (await booted.call("bob", `/projects/owners/builds/${id}`)).text();
    expect(after).toContain("Approved");
    await booted.stop();
  });

  it("shows no assigned row when nothing matched", async () => {
    const booted = await boot({
      componentOwners: JSON.stringify([{ pattern: "src/other/**", owners: ["alice"] }]),
    });
    const id = await publish(booted);
    const html = await (await booted.call("bob", `/projects/owners/builds/${id}`)).text();
    expect(html).not.toContain("Assigned reviewers");
    expect(html).not.toContain("Assigned from component owners");
    await booted.stop();
  });
});
