import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { GitLinkStateError } from "./git-link-state-error.ts";
import {
  anyRepositoryLinkAllowed,
  GIT_LINK_ANY_REPOSITORY_KEY,
  GitRepositoryLinkModel,
  linkOutputsOf,
} from "./git-repository-link.ts";
import { GitRepositoryTakenError } from "./git-repository-taken-error.ts";
import { NotificationChannelModel } from "./notification-channel.ts";
import { SiteSettingsModel } from "./site-settings.ts";

const INPUT = {
  projectId: "p1",
  connectionId: "c1",
  host: "API.github.com",
  owner: "Acme",
  repo: "Web",
};

describe("GitRepositoryLinkModel", () => {
  it("creates a pending link with a lower-case key", async () => {
    const { db } = makeDatabase();
    const model = new GitRepositoryLinkModel(db);
    const link = await model.create({ ...INPUT, requestedBy: "u1" });
    expect(link).toMatchObject({
      state: "pending",
      host: "api.github.com",
      owner: "acme",
      repo: "web",
      prefix: "",
      outputs: "{}",
      requestedBy: "u1",
    });
    expect(await model.list("p1")).toHaveLength(1);
    expect(await model.list("other")).toHaveLength(0);
  });

  it("refuses a second link of the same repository and prefix, allows another prefix", async () => {
    const { db } = makeDatabase();
    const model = new GitRepositoryLinkModel(db);
    await model.create(INPUT);
    await expect(model.create({ ...INPUT, projectId: "p2", owner: "ACME" })).rejects.toThrow(
      GitRepositoryTakenError,
    );
    await expect(model.create({ ...INPUT, prefix: "e2e" })).resolves.toMatchObject({
      prefix: "e2e",
    });
  });

  it("refuses a repository a project's git channel already posts to", async () => {
    const { db } = makeDatabase();
    await new NotificationChannelModel(db).create({
      projectId: "p9",
      provider: "github",
      config: { owner: "acme", repo: "web" },
    });
    const model = new GitRepositoryLinkModel(db);
    await expect(model.create(INPUT)).rejects.toMatchObject({ takenBy: "channel" });
    await expect(model.create({ ...INPUT, prefix: "e2e" })).resolves.toBeDefined();
  });

  it("matches a channel's host and default prefix, and ignores other channels", async () => {
    const { db } = makeDatabase();
    const channels = new NotificationChannelModel(db);
    await channels.create({
      projectId: "p9",
      provider: "gitlab",
      config: {
        owner: "acme",
        repo: "web",
        host: "https://git.example.com/",
        prefix: "storyshelf",
      },
    });
    await channels.create({
      projectId: "p9",
      provider: "github",
      config: { owner: "acme", repo: "web", apiUrl: "not a url" },
    });
    await channels.create({ projectId: "p9", provider: "slack", config: {} });
    await channels.create({
      projectId: null,
      provider: "github",
      config: { owner: "acme", repo: "web" },
    });
    const model = new GitRepositoryLinkModel(db);
    await expect(model.create({ ...INPUT, host: "git.example.com" })).rejects.toThrow(
      GitRepositoryTakenError,
    );
    await expect(model.create({ ...INPUT, host: "gitlab.com" })).resolves.toBeDefined();
  });
});

async function pending() {
  const { db } = makeDatabase();
  const model = new GitRepositoryLinkModel(db);
  return { db, model, link: await model.create(INPUT) };
}

describe("GitRepositoryLinkModel transitions", () => {
  it("approves a pending link, pinning the repository and installation", async () => {
    const { model, link } = await pending();
    const approved = await model.approve(
      link.id,
      { hostRepositoryId: "42", installationId: "7" },
      "admin",
    );
    expect(approved).toMatchObject({
      state: "approved",
      hostRepositoryId: "42",
      installationId: "7",
      approvedBy: "admin",
      reason: null,
    });
    expect(approved.approvedAt).not.toBeNull();
    await expect(model.approve(link.id, { hostRepositoryId: "42" }, "admin")).rejects.toThrow(
      GitLinkStateError,
    );
  });

  it("refuses only a pending link and keeps the record", async () => {
    const { model, link } = await pending();
    expect(await model.refuse(link.id, "not ours")).toMatchObject({
      state: "refused",
      reason: "not ours",
    });
    await expect(model.approve(link.id, { hostRepositoryId: "1" }, "a")).rejects.toMatchObject({
      state: "refused",
    });
    expect(await model.get(link.id)).toMatchObject({ state: "refused" });
  });

  it("breaks only an approved link, and a reconnect or restore approves it again", async () => {
    const { model, link } = await pending();
    expect(await model.markBroken(link.id, "gone")).toBeNull();
    await model.approve(link.id, { hostRepositoryId: "42", installationId: "7" }, "a");
    expect(await model.markBroken(link.id, "uninstalled")).toMatchObject({
      state: "broken",
      reason: "uninstalled",
    });
    expect(await model.restore(link.id)).toMatchObject({
      state: "approved",
      reason: null,
      hostRepositoryId: "42",
    });
    await model.markBroken(link.id, "again");
    expect(await model.approve(link.id, { hostRepositoryId: "43" }, "b")).toMatchObject({
      state: "approved",
      hostRepositoryId: "43",
      installationId: null,
    });
    await expect(model.restore(link.id)).rejects.toThrow(GitLinkStateError);
    expect(await model.markBroken("missing", "x")).toBeNull();
  });

  it("pins only an approved link", async () => {
    const { model, link } = await pending();
    expect(await model.pin(link.id, { hostRepositoryId: "1" })).toBeNull();
    await model.approve(link.id, { hostRepositoryId: "1", installationId: "2" }, "a");
    expect(await model.pin(link.id, { hostRepositoryId: "1", installationId: "3" })).toMatchObject({
      installationId: "3",
    });
  });

  it("returns an approved link to pending when its repository, connection or prefix changes", async () => {
    const { model, link } = await pending();
    const pins = { hostRepositoryId: "42", installationId: "7" };
    await model.approve(link.id, pins, "a");
    expect(await model.change(link.id, { owner: "ACME", repo: "web" })).toMatchObject({
      state: "approved",
    });
    expect(await model.change(link.id, { repo: "Other" })).toMatchObject({
      state: "pending",
      repo: "other",
      hostRepositoryId: null,
      installationId: null,
      approvedBy: null,
      approvedAt: null,
    });
    await model.approve(link.id, pins, "a");
    expect(await model.change(link.id, { connectionId: "c2" })).toMatchObject({
      state: "pending",
      connectionId: "c2",
    });
    await model.approve(link.id, pins, "a");
    expect(await model.change(link.id, { prefix: "e2e" })).toMatchObject({
      state: "pending",
      prefix: "e2e",
    });
  });

  it("refuses a change onto a key another link holds, and a change of a missing link", async () => {
    const { model, link } = await pending();
    await model.create({ ...INPUT, repo: "api" });
    await expect(model.change(link.id, { repo: "api" })).rejects.toThrow(GitRepositoryTakenError);
    await expect(model.change("missing", { repo: "x" })).rejects.toThrow(GitLinkStateError);
  });

  it("stamps a delivery without touching the link's state or update time", async () => {
    const { model, link } = await pending();
    expect(link.lastDeliveredAt).toBeNull();
    await model.markDelivered(link.id, "2026-11-20T10:00:00.000Z");
    expect(await model.get(link.id)).toMatchObject({
      lastDeliveredAt: "2026-11-20T10:00:00.000Z",
      state: link.state,
      updatedAt: link.updatedAt,
    });
  });

  it("creates a link already approved, lists by state, stores outputs and removes", async () => {
    const { model, link } = await pending();
    const assigned = await model.create({ ...INPUT, repo: "api" }, { approvedBy: "admin" });
    expect(assigned).toMatchObject({ state: "approved", approvedBy: "admin" });
    expect((await model.listAll("pending")).map((row) => row.id)).toEqual([link.id]);
    expect(await model.listAll()).toHaveLength(2);
    expect(linkOutputsOf(link)).toEqual({ storybook: true, comment: "always", annotations: true });
    const stored = await model.setOutputs(link.id, {
      storybook: false,
      comment: "on-changes",
      annotations: false,
    });
    expect(linkOutputsOf(stored)).toEqual({
      storybook: false,
      comment: "on-changes",
      annotations: false,
    });
    await model.remove(link.id);
    expect(await model.get(link.id)).toBeNull();
  });
});

describe("anyRepositoryLinkAllowed", () => {
  it("is off until an operator turns it on", async () => {
    const { db } = makeDatabase();
    const settings = new SiteSettingsModel(db);
    expect(await anyRepositoryLinkAllowed(settings)).toBe(false);
    await settings.set(GIT_LINK_ANY_REPOSITORY_KEY, "true", "u1");
    expect(await anyRepositoryLinkAllowed(settings)).toBe(true);
    await settings.set(GIT_LINK_ANY_REPOSITORY_KEY, "false");
    expect(await anyRepositoryLinkAllowed(settings)).toBe(false);
  });
});
