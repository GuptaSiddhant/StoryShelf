import { gitlabGroup } from "@storyshelf/core/integrations";
import {
  GIT_LINK_ANY_REPOSITORY_KEY,
  GitRepositoryLinkModel,
  ProjectModel,
  SiteSettingsModel,
} from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";

const secret = "test-secret";
const TOKEN = "glpat-very-secret";
const GITLAB = gitlabGroup({
  id: "gl",
  host: "https://gitlab.example.com",
  token: TOKEN,
  expiresOn: "2099-01-01",
});
const BASE = "/projects/web/settings/git";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup(anyRepository: boolean) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await new ProjectModel(db).create({ name: "Web" });
  await new SiteSettingsModel(db).set(GIT_LINK_ANY_REPOSITORY_KEY, String(anyRepository));
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret },
    git: { connections: [GITLAB], links: [] },
  });
  return { app, project, links: new GitRepositoryLinkModel(db) };
}

/** Answer the group's project listing; every page is `projects` long. */
function stubGitLab(respond: (page: number) => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    await Promise.resolve();
    return url.includes("gitlab.example.com")
      ? respond(Number(new URL(url).searchParams.get("page")))
      : new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const projects = (...paths: string[]) =>
  Response.json(paths.map((path_with_namespace) => ({ path_with_namespace })));

function post(app: Awaited<ReturnType<typeof setup>>["app"], body: Record<string, string>) {
  return app.request(BASE, {
    method: "POST",
    headers: {
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
      "x-csrf-token": getCsrfToken(secret, "default"),
    },
    body: new URLSearchParams(body).toString(),
  });
}

describe("link form repository picker", () => {
  it("is URL-only and never asks the host while the operator switch is off", async () => {
    const fetchMock = stubGitLab(() => projects("grp/web"));
    const { app } = await setup(false);
    const html = await (await app.request(`${BASE}/new`)).text();
    expect(html).toContain('name="repository"');
    expect(html).not.toContain('name="picked"');
    expect(html).not.toContain("grp/web");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers the covered repositories with the switch on, beside a typed URL", async () => {
    const fetchMock = stubGitLab(() => projects("grp/web", "grp/api"));
    const { app } = await setup(true);
    const html = await (await app.request(`${BASE}/new`)).text();
    expect(html).toContain('name="picked"');
    expect(html).toContain('value="https://gitlab.example.com/grp/api"');
    expect(html).toContain('name="repository"');
    expect(html).not.toContain("cut short");
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("private-token")).toBe(TOKEN);
  });

  it("requests a link for a picked repository like a typed one", async () => {
    stubGitLab(() => projects("grp/web"));
    const { app, project, links } = await setup(true);
    const saved = await post(app, {
      source: "pick",
      picked: "https://gitlab.example.com/grp/web",
      prefix: "web",
    });
    expect(saved.status).toBe(302);
    expect(await links.list(project.id)).toMatchObject([{ owner: "grp", repo: "web" }]);
  });

  it("still resolves a typed URL as before", async () => {
    stubGitLab(() => projects("grp/web"));
    const { app, project, links } = await setup(true);
    await post(app, {
      source: "type",
      repository: "https://gitlab.example.com/grp/typed",
      prefix: "typed",
    });
    expect(await links.list(project.id)).toMatchObject([{ owner: "grp", repo: "typed" }]);
  });

  it("says when the list was cut short", async () => {
    stubGitLab((page) => projects(...Array.from({ length: 100 }, (_, i) => `grp/p${page}-${i}`)));
    const { app } = await setup(true);
    const html = await (await app.request(`${BASE}/new`)).text();
    expect(html).toContain("This list was cut short");
  });

  it("falls back to the typed URL when listing fails, without a status, body or token", async () => {
    stubGitLab(() => new Response(`${TOKEN} rejected`, { status: 403 }));
    const { app } = await setup(true);
    const response = await app.request(`${BASE}/new`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("could not be listed");
    expect(html).toContain('name="repository"');
    expect(html).not.toContain('name="picked"');
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain("HTTP 403");
  });
});
