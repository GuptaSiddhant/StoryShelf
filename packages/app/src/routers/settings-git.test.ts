import { gitlabGroup } from "@storyshelf/core/integrations";
import { GitRepositoryLinkModel, ProjectModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";

const secret = "test-secret";
const GITLAB = gitlabGroup({
  id: "gl",
  host: "https://gitlab.example.com",
  token: "glpat-x",
  expiresOn: "2099-01-01",
});

async function setup(options: { connected?: boolean; configured?: boolean } = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await new ProjectModel(db).create({ name: "Web" });
  const connected = options.connected ?? true;
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret },
    ...(connected
      ? {
          git: {
            connections: [GITLAB],
            links: options.configured
              ? [{ connection: "gl", project: project.slug, repository: "grp/managed" }]
              : [],
          },
        }
      : {}),
  });
  return { db, project, app, links: new GitRepositoryLinkModel(db) };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function post(app: Setup["app"], path: string, body: Record<string, string>) {
  return app.request(path, {
    method: "POST",
    headers: {
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
      "x-csrf-token": getCsrfToken(secret, "default"),
    },
    body: new URLSearchParams(body).toString(),
  });
}

const BASE = "/projects/web/settings/git";
const REVIEW = "/projects/web/settings/review";

describe("Project → Settings → Git", () => {
  it("is not shown, and its pages answer 404, while the server has no connection", async () => {
    const { app } = await setup({ connected: false });
    const html = await (await app.request(REVIEW)).text();
    expect(html).not.toContain("Link a repository");
    expect((await app.request(`${BASE}/new`)).status).toBe(404);
    expect(
      (await post(app, BASE, { repository: "https://gitlab.example.com/grp/web" })).status,
    ).toBe(404);
  });

  it("shows the empty state and the link form with a connection", async () => {
    const { app } = await setup();
    const html = await (await app.request(REVIEW)).text();
    expect(html).toContain("No repository linked");
    const form = await (await app.request(`${BASE}/new`)).text();
    expect(form).toContain('name="repository"');
    expect(form).toContain('value="storyshelf"');
  });

  it("requests a link that waits for a site admin", async () => {
    const { app, project, links } = await setup();
    const saved = await post(app, BASE, {
      repository: "https://gitlab.example.com/grp/web.git",
      prefix: "web",
    });
    expect(saved.status).toBe(302);
    const [link] = await links.list(project.id);
    expect(link).toMatchObject({ owner: "grp", repo: "web", prefix: "web", state: "pending" });
    const html = await (await app.request(REVIEW)).text();
    expect(html).toContain("Waiting for approval");
    expect(html).toContain("web/testing");
  });

  it("answers a repository on no known host the same way whatever it is (no probing)", async () => {
    const { app, links, project } = await setup();
    const unknownHost = await post(app, BASE, { repository: "https://example.org/acme/private" });
    const notAUrl = await post(app, BASE, { repository: "%%%" });
    expect(unknownHost.status).toBe(400);
    expect(notAUrl.status).toBe(400);
    expect(await unknownHost.text()).toContain("a host this server connects to");
    expect(await links.list(project.id)).toEqual([]);
  });

  it("refuses a repository and prefix that are already linked, and a bad prefix", async () => {
    const { app } = await setup();
    const body = { repository: "grp/web", prefix: "web" };
    expect((await post(app, BASE, body)).status).toBe(302);
    const again = await post(app, BASE, body);
    expect(again.status).toBe(400);
    const html = await again.text();
    expect(html).toContain("Choose another prefix");
    expect(html).toContain('value="grp/web"');
    const bad = await post(app, BASE, { repository: "grp/other", prefix: "no spaces" });
    expect(bad.status).toBe(400);
  });

  it("prefills the edit form with the repository's URL on its connection's host", async () => {
    const { app, project, links } = await setup();
    await post(app, BASE, { repository: "grp/web", prefix: "web" });
    const [link] = await links.list(project.id);
    const form = await (await app.request(`${BASE}/${link?.id}/edit`)).text();
    expect(form).toContain('value="https://gitlab.example.com/grp/web"');
  });

  it("edits outputs, and a changed prefix sends the link back to pending", async () => {
    const { app, project, links } = await setup();
    await post(app, BASE, { repository: "grp/web", prefix: "web" });
    const [link] = await links.list(project.id);
    await links.approve(link?.id ?? "", { hostRepositoryId: "7" }, null);
    const saved = await post(app, `${BASE}/${link?.id}`, {
      repository: "grp/web",
      prefix: "web",
      comment: "off",
    });
    expect(saved.status).toBe(302);
    const kept = await links.get(link?.id ?? "");
    expect(kept?.state).toBe("approved");
    expect(JSON.parse(kept?.outputs ?? "{}")).toMatchObject({
      storybook: false,
      comment: "off",
      annotations: false,
    });
    await post(app, `${BASE}/${link?.id}`, { repository: "grp/web", prefix: "web2" });
    expect((await links.get(link?.id ?? ""))?.state).toBe("pending");
  });

  it("removes a link", async () => {
    const { app, project, links } = await setup();
    await post(app, BASE, { repository: "grp/web" });
    const [link] = await links.list(project.id);
    expect((await post(app, `${BASE}/${link?.id}/delete`, {})).status).toBe(302);
    expect(await links.list(project.id)).toEqual([]);
  });

  it("does not touch another project's link", async () => {
    const { app, db, links } = await setup();
    const other = await new ProjectModel(db).create({ name: "Other" });
    const foreign = await links.create({
      projectId: other.id,
      connectionId: "gl",
      host: "gitlab.example.com",
      owner: "grp",
      repo: "theirs",
    });
    expect((await post(app, `${BASE}/${foreign.id}/delete`, {})).status).toBe(404);
    expect((await app.request(`${BASE}/${foreign.id}/edit`)).status).toBe(404);
  });
});
