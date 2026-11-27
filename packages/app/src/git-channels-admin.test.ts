import { NotificationChannelModel, type GitConnection } from "@storyshelf/core/models";
import { createTestProject, makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { gitChannelCount, loadGitChannelViews } from "./git-channels-admin.ts";
import { runWithStore, type Store } from "./store.ts";

const SECRET = "channels-admin-secret-0123456789abcdef";

function connection(overrides: Partial<GitConnection>): GitConnection {
  return {
    id: "c1",
    provider: "github-app",
    name: "Acme App",
    apiBase: null,
    config: { appId: "42" },
    state: "active",
    managed: false,
    ignored: false,
    createdBy: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

async function seed() {
  const { db } = makeDatabase();
  const project = await createTestProject(db, db.tables, { name: "Web" });
  const channels = new NotificationChannelModel(db, undefined, SECRET);
  const store = { db, config: { secret: SECRET } } as unknown as Store;
  return { db, project, channels, store };
}

describe("loadGitChannelViews", () => {
  it("offers the fitting connections, and the channel's own App only when none is that App", async () => {
    const { project, channels, store } = await seed();
    await channels.create({
      projectId: project.id,
      provider: "github",
      config: { owner: "acme", repo: "web", mode: "checks", appId: "42", installationId: "1" },
      secret: "key",
    });
    const views = await runWithStore(
      store,
      async () =>
        await loadGitChannelViews([
          connection({}),
          connection({ id: "c2", provider: "gitlab-token", name: "GitLab" }),
        ]),
    );
    expect(views).toMatchObject([
      {
        kind: "github-app",
        kindLabel: "GitHub App",
        repository: "acme/web",
        project: { name: "Web" },
        connections: [{ id: "c1", name: "Acme App" }],
        canCreate: false,
      },
    ]);
    const other = await runWithStore(
      store,
      async () => await loadGitChannelViews([connection({ config: { appId: "7" } })]),
    );
    expect(other[0]?.canCreate).toBe(true);
    expect(JSON.stringify(other)).not.toContain("key");
  });

  it("counts the channels left, on the whole server", async () => {
    const { project, channels, store } = await seed();
    await channels.create({
      projectId: project.id,
      provider: "gitlab",
      config: { owner: "a", repo: "b" },
    });
    await channels.create({
      projectId: "other",
      provider: "github",
      config: { owner: "a", repo: "c" },
    });
    await channels.create({ projectId: project.id, provider: "slack-webhook", config: {} });
    await runWithStore(store, async () => {
      expect(await gitChannelCount()).toBe(2);
      expect(await loadGitChannelViews([])).toHaveLength(2);
    });
  });
});
