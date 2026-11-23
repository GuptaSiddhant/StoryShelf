import { describe, expect, it } from "vitest";
import { githubApp } from "../integrations/git/connections/define.ts";
import { TEST_PRIVATE_KEY } from "../integrations/git/test-key.ts";
import { createShelfLogger } from "../logger.ts";
import { makeDatabase } from "../test-helpers/fake-database.ts";
import { GitConnectionModel } from "./git-connection.ts";
import { CONNECTION_REMOVED_REASON, syncConfiguredLinks } from "./git-link-sync.ts";
import { GitRepositoryLinkModel } from "./git-repository-link.ts";
import { NotificationChannelModel } from "./notification-channel.ts";
import { ProjectModel } from "./project.ts";

const SECRET = "test-secret-0123456789abcdef";
const APP = githubApp({ id: "gh", appId: 42, privateKey: TEST_PRIVATE_KEY });
const logger = createShelfLogger({ level: "silent" });

async function setup(configured = [APP]) {
  const { db } = makeDatabase();
  const project = await new ProjectModel(db).create({ name: "Web" });
  const other = await new ProjectModel(db).create({ name: "Api" });
  const connections = new GitConnectionModel(db, SECRET, configured);
  const links = new GitRepositoryLinkModel(db);
  return { db, project, other, connections, links, deps: { db, connections, logger } };
}

describe("syncConfiguredLinks", () => {
  it("creates a configured link approved, by project id or slug, idempotently", async () => {
    const { project, links, deps } = await setup();
    const entry = { connection: "gh", project: project.slug, repository: "Acme/Web" };
    const first = await syncConfiguredLinks(deps, [entry]);
    expect(first.managed).toHaveLength(1);
    expect(await links.list(project.id)).toEqual([
      expect.objectContaining({
        state: "approved",
        host: "api.github.com",
        owner: "acme",
        repo: "web",
        approvedBy: null,
        hostRepositoryId: null,
      }),
    ]);
    const again = await syncConfiguredLinks(deps, [{ ...entry, project: project.id }]);
    expect(again.managed).toEqual(first.managed);
    expect(await links.list(project.id)).toHaveLength(1);
  });

  it("approves a pending or refused link of the same project by configuration", async () => {
    const { project, links, deps } = await setup();
    const link = await links.create({
      projectId: project.id,
      connectionId: "gh",
      host: "api.github.com",
      owner: "acme",
      repo: "web",
      prefix: "e2e",
    });
    await links.refuse(link.id, "no");
    await syncConfiguredLinks(deps, [
      { connection: "gh", project: project.id, repository: "acme/web", prefix: "e2e" },
    ]);
    expect(await links.get(link.id)).toMatchObject({ state: "approved", reason: null });
  });

  it("forgets the pins when configuration moves a link to another connection", async () => {
    const other = githubApp({ id: "gh2", appId: 43, privateKey: TEST_PRIVATE_KEY });
    const { project, links, deps } = await setup([APP, other]);
    const link = await links.create(
      {
        projectId: project.id,
        connectionId: "gh",
        host: "api.github.com",
        owner: "acme",
        repo: "web",
      },
      { approvedBy: null },
    );
    await links.pin(link.id, { hostRepositoryId: "1", installationId: "2" });
    await syncConfiguredLinks(deps, [
      { connection: "gh2", project: project.id, repository: "acme/web" },
    ]);
    expect(await links.get(link.id)).toMatchObject({
      connectionId: "gh2",
      hostRepositoryId: null,
      installationId: null,
    });
  });

  it("skips unknown projects and connections, and repositories another project or channel holds", async () => {
    const { db, project, other, links, deps } = await setup();
    await links.create({
      projectId: other.id,
      connectionId: "gh",
      host: "api.github.com",
      owner: "acme",
      repo: "taken",
    });
    await new NotificationChannelModel(db).create({
      projectId: other.id,
      provider: "github",
      config: { owner: "acme", repo: "chan" },
    });
    const result = await syncConfiguredLinks(deps, [
      { connection: "gh", project: "nope", repository: "acme/web" },
      { connection: "nope", project: project.id, repository: "acme/web" },
      { connection: "gh", project: project.id, repository: "acme/taken" },
      { connection: "gh", project: project.id, repository: "acme/chan" },
    ]);
    expect(result.managed).toEqual([]);
    expect(result.skipped.map((skip) => skip.reason)).toEqual([
      "unknown project",
      "unknown connection",
      "linked by another project",
      "already used by a git channel",
    ]);
  });

  it("marks links broken when their connection is removed, and restores them when it returns", async () => {
    const { db, project, links, deps } = await setup();
    const link = await links.create(
      {
        projectId: project.id,
        connectionId: "gh",
        host: "api.github.com",
        owner: "acme",
        repo: "web",
      },
      { approvedBy: null },
    );
    const withoutApp = { db, connections: new GitConnectionModel(db, SECRET, []), logger };
    expect((await syncConfiguredLinks(withoutApp, [])).broken).toBe(1);
    expect(await links.get(link.id)).toMatchObject({
      state: "broken",
      reason: CONNECTION_REMOVED_REASON,
    });
    expect((await syncConfiguredLinks(deps, [])).restored).toBe(1);
    expect(await links.get(link.id)).toMatchObject({ state: "approved", reason: null });
    await links.markBroken(link.id, "uninstalled");
    expect((await syncConfiguredLinks(deps, [])).restored).toBe(0);
  });
});

describe("syncConfiguredLinks and a link its host broke", () => {
  it("leaves a configured link broken by its host until it is reconnected", async () => {
    const { project, links, deps } = await setup();
    const entry = { connection: "gh", project: project.id, repository: "acme/web" };
    const [id] = (await syncConfiguredLinks(deps, [entry])).managed;
    await links.markBroken(id ?? "", "uninstalled");
    await syncConfiguredLinks(deps, [entry]);
    expect(await links.get(id ?? "")).toMatchObject({ state: "broken", reason: "uninstalled" });
  });
});
