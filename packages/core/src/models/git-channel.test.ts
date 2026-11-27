import { describe, expect, it } from "vitest";
import type { NotificationChannelRow } from "../schema/notification.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import {
  connectionFits,
  connectionProviderFor,
  listPerProjectGitChannels,
  perProjectGitChannelOf,
} from "./git-channel.ts";
import { NotificationChannelModel } from "./notification-channel.ts";

function row(
  provider: string,
  config: Record<string, unknown>,
  overrides: Partial<NotificationChannelRow> = {},
): NotificationChannelRow {
  return {
    id: "ch1",
    projectId: "p1",
    provider,
    config: JSON.stringify(config),
    secretEncrypted: "enc",
    events: null,
    enabled: true,
    lastError: null,
    lastErrorAt: null,
    lastDeliveredAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("perProjectGitChannelOf", () => {
  it("reads a GitHub App channel with its App id, API base and key as a link stores it", () => {
    const channel = perProjectGitChannelOf(
      row("github", {
        owner: "Acme",
        repo: "Web",
        mode: "checks",
        appId: "42",
        installationId: "7",
        apiUrl: "https://GHES.example.com/api/v3",
        prefix: "e2e",
      }),
    );
    expect(channel).toEqual({
      id: "ch1",
      projectId: "p1",
      kind: "github-app",
      host: "ghes.example.com",
      owner: "acme",
      repo: "web",
      prefix: "e2e",
      appId: "42",
      apiUrl: "https://GHES.example.com/api/v3",
      enabled: true,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("reads a token channel, and the default prefix as the empty string", () => {
    expect(
      perProjectGitChannelOf(row("github", { owner: "a", repo: "b", prefix: "storyshelf" })),
    ).toMatchObject({ kind: "github-token", host: "api.github.com", prefix: "", appId: null });
    expect(
      perProjectGitChannelOf(
        row("gitlab", { owner: "g", repo: "r", host: "https://git.example.com" }),
      ),
    ).toMatchObject({
      kind: "gitlab-token",
      host: "git.example.com",
      apiUrl: "https://git.example.com",
    });
  });

  it("is null for chat channels, site-wide channels and a config without a repository", () => {
    expect(perProjectGitChannelOf(row("slack-webhook", {}))).toBeNull();
    expect(
      perProjectGitChannelOf(row("github", { owner: "a", repo: "b" }, { projectId: null })),
    ).toBeNull();
    expect(perProjectGitChannelOf(row("github", { owner: "a" }))).toBeNull();
    expect(perProjectGitChannelOf(row("github", {}, { config: "not json" }))).toBeNull();
  });
});

describe("connectionFits", () => {
  const github = { kind: "github-token" as const, host: "api.github.com" };
  it("takes an App on the same host for a GitHub channel, never a token", () => {
    expect(connectionProviderFor(github)).toBe("github-app");
    expect(connectionFits(github, { provider: "github-app", apiBase: null })).toBe(true);
    expect(
      connectionFits(github, {
        provider: "github-app",
        apiBase: "https://ghes.example.com/api/v3",
      }),
    ).toBe(false);
    expect(connectionFits(github, { provider: "gitlab-token", apiBase: null })).toBe(false);
    expect(connectionFits(github, { provider: "github-app", apiBase: null, ignored: true })).toBe(
      false,
    );
  });

  it("takes a GitLab connection on the same host for a GitLab channel", () => {
    const gitlab = { kind: "gitlab-token" as const, host: "git.example.com" };
    expect(
      connectionFits(gitlab, { provider: "gitlab-token", apiBase: "https://git.example.com" }),
    ).toBe(true);
    expect(connectionFits(gitlab, { provider: "gitlab-token", apiBase: null })).toBe(false);
  });
});

describe("listPerProjectGitChannels", () => {
  it("lists only the projects' git channels", async () => {
    const { db } = makeDatabase();
    const channels = new NotificationChannelModel(db, undefined, "test-secret-0123456789abcdef");
    await channels.create({
      projectId: "p1",
      provider: "github",
      config: { owner: "a", repo: "b" },
    });
    await channels.create({ projectId: "p1", provider: "slack-webhook", config: {} });
    await channels.create({ projectId: null, provider: "email", config: {} });
    const listed = await listPerProjectGitChannels(db);
    expect(listed.map((channel) => channel.repo)).toEqual(["b"]);
  });
});
