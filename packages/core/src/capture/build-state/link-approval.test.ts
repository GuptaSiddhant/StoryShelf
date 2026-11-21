import { afterEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../../integrations/git/test-fetch.ts";
import { GitLinkStateError } from "../../models/git-link-state-error.ts";
import { GIT_LINK_ANY_REPOSITORY_KEY } from "../../models/git-repository-link.ts";
import { SiteSettingsModel } from "../../models/site-settings.ts";
import { approveRepositoryLink, requestRepositoryLink } from "./link-approval.ts";
import { GITHUB_ID, linkWorld } from "./link-world.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** GitHub answers that installation 777 covers repository 9001. */
function covered(): void {
  stubFetch((url) =>
    url.endsWith("/installation")
      ? Response.json({ id: 777 })
      : Response.json({ repositories: [{ id: 9001, full_name: "acme/web" }] }, { status: 201 }),
  );
}

async function setup() {
  const w = await linkWorld();
  const publisher = { request: vi.fn(async () => {}) };
  const settings = new SiteSettingsModel(w.db);
  const deps = {
    db: w.db,
    gitConnections: w.connections,
    publisher,
    logger: w.deps.logger,
    settings,
  };
  const input = {
    projectId: w.project.id,
    connectionId: GITHUB_ID,
    host: "api.github.com",
    owner: "acme",
    repo: "web",
    requestedBy: "u1",
  };
  return { w, publisher, settings, deps, input };
}

describe("approveRepositoryLink", () => {
  it("pins the repository id and asks for the project's open builds through the link", async () => {
    const { w, publisher, deps, input } = await setup();
    const link = await w.links.create(input);
    covered();
    const result = await approveRepositoryLink(deps, link.id, "admin");
    expect(result).toMatchObject({
      approved: true,
      asked: 1,
      link: {
        state: "approved",
        hostRepositoryId: "9001",
        installationId: "777",
        approvedBy: "admin",
      },
    });
    expect(publisher.request).toHaveBeenCalledWith(w.build.id, { linkId: link.id });
  });

  it("cannot approve a repository the connection does not cover", async () => {
    const { w, publisher, deps, input } = await setup();
    const link = await w.links.create(input);
    stubFetch(() => new Response("{}", { status: 404 }));
    expect(await approveRepositoryLink(deps, link.id, "admin")).toEqual({
      approved: false,
      reason: "not-covered",
    });
    expect(await w.links.get(link.id)).toMatchObject({ state: "pending" });
    expect(publisher.request).not.toHaveBeenCalled();
  });

  it("answers no-connection when the connection is gone, and throws when inconclusive", async () => {
    const { w, deps, input } = await setup();
    const orphan = await w.links.create({ ...input, connectionId: "gone" });
    expect(await approveRepositoryLink(deps, orphan.id, "a")).toEqual({
      approved: false,
      reason: "no-connection",
    });
    const link = await w.links.create({ ...input, repo: "api" });
    stubFetch(() => new Response("{}", { status: 503 }));
    await expect(approveRepositoryLink(deps, link.id, "a")).rejects.toThrow();
    expect(await w.links.get(link.id)).toMatchObject({ state: "pending" });
  });

  it("reconnects a broken link and refuses a refused or approved one", async () => {
    const { w, deps, input } = await setup();
    const link = await w.links.create(input);
    await w.links.approve(link.id, { hostRepositoryId: "1", installationId: "2" }, "a");
    await expect(approveRepositoryLink(deps, link.id, "a")).rejects.toThrow(GitLinkStateError);
    await w.links.markBroken(link.id, "gone");
    covered();
    expect(await approveRepositoryLink(deps, link.id, "a")).toMatchObject({ approved: true });
    const refused = await w.links.create({ ...input, repo: "api" });
    await w.links.refuse(refused.id);
    await expect(approveRepositoryLink(deps, refused.id, "a")).rejects.toThrow(GitLinkStateError);
    await expect(approveRepositoryLink(deps, "missing", "a")).rejects.toThrow(GitLinkStateError);
  });
});

describe("requestRepositoryLink", () => {
  it("leaves a project admin's link pending while the operator switch is off", async () => {
    const { deps, input } = await setup();
    const calls = stubFetch(() => Response.json({}));
    expect(await requestRepositoryLink(deps, input)).toMatchObject({ state: "pending" });
    expect(calls).toHaveLength(0);
  });

  it("approves it at once with the switch on, when the connection covers it", async () => {
    const { deps, input, settings } = await setup();
    await settings.set(GIT_LINK_ANY_REPOSITORY_KEY, "true");
    covered();
    expect(await requestRepositoryLink(deps, input)).toMatchObject({
      state: "approved",
      approvedBy: "u1",
      hostRepositoryId: "9001",
    });
  });

  it("keeps it pending, with the same answer, when not covered or the check fails", async () => {
    const { deps, input, settings } = await setup();
    await settings.set(GIT_LINK_ANY_REPOSITORY_KEY, "true");
    stubFetch(() => new Response("{}", { status: 404 }));
    expect(await requestRepositoryLink(deps, input)).toMatchObject({ state: "pending" });
    stubFetch(() => new Response("{}", { status: 503 }));
    expect(await requestRepositoryLink(deps, { ...input, repo: "api" })).toMatchObject({
      state: "pending",
    });
  });
});
