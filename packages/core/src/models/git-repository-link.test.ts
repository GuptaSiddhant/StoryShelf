import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import {
  anyRepositoryLinkAllowed,
  GIT_LINK_ANY_REPOSITORY_KEY,
  GitRepositoryLinkModel,
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
