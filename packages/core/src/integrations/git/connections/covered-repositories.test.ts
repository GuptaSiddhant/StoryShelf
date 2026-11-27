import { afterEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../test-fetch.ts";
import { TEST_PRIVATE_KEY } from "../test-key.ts";
import {
  listCoveredRepositories,
  MAX_INSTALLATIONS,
  MAX_REPOSITORY_PAGES,
  REPOSITORIES_PER_PAGE,
  RepositoryListError,
} from "./covered-repositories.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const GITHUB = { provider: "github-app", apiBase: null, config: { appId: "42" } };
const GITLAB = {
  provider: "gitlab-token",
  apiBase: "https://gitlab.example.com",
  config: { group: "acme/web" },
};

const fullPage = (prefix: string, page: number) =>
  Array.from({ length: REPOSITORIES_PER_PAGE }, (_, index) => `${prefix}/r${page}-${index}`);

function github(repositories: (page: number) => string[], installations = [{ id: 7 }]) {
  return stubFetch((url) => {
    if (url.includes("/app/installations?")) {
      return Response.json(installations);
    }
    if (url.endsWith("/access_tokens")) {
      return Response.json({ token: "ghs_secret_token" }, { status: 201 });
    }
    const page = Number(new URL(url).searchParams.get("page"));
    return Response.json({
      repositories: repositories(page).map((full_name) => ({ full_name })),
    });
  });
}

describe("listCoveredRepositories: GitHub", () => {
  it("lists the installation's repositories, sorted, with the App's JWT then the installation token", async () => {
    const calls = github(() => ["acme/web", "acme/api"]);
    const result = await listCoveredRepositories(GITHUB, TEST_PRIVATE_KEY);
    expect(result).toEqual({
      repositories: [{ fullName: "acme/api" }, { fullName: "acme/web" }],
      truncated: false,
    });
    const auth = (index: number) => new Headers(calls[index]?.init.headers).get("authorization");
    expect(calls[0]?.url).toBe("https://api.github.com/app/installations?per_page=100&page=1");
    expect(auth(0)).toMatch(/^Bearer eyJ/u);
    expect(calls[1]?.url).toBe("https://api.github.com/app/installations/7/access_tokens");
    expect(calls[2]?.url).toBe(
      "https://api.github.com/installation/repositories?per_page=100&page=1",
    );
    expect(auth(2)).toBe("Bearer ghs_secret_token");
  });

  it("reads another page while pages are full, then stops at a short one", async () => {
    const calls = github((page) => (page < 3 ? fullPage("acme", page) : ["acme/last"]));
    const result = await listCoveredRepositories(GITHUB, TEST_PRIVATE_KEY);
    expect(result.repositories).toHaveLength(2 * REPOSITORIES_PER_PAGE + 1);
    expect(result.truncated).toBe(false);
    expect(calls.filter((call) => call.url.includes("/installation/repositories"))).toHaveLength(3);
  });

  it("stops at the page cap and says the list was cut short", async () => {
    const calls = github((page) => fullPage("acme", page));
    const result = await listCoveredRepositories(GITHUB, TEST_PRIVATE_KEY);
    const pages = calls.filter((call) => call.url.includes("/installation/repositories"));
    // One page of the budget went to the installation list.
    expect(pages).toHaveLength(MAX_REPOSITORY_PAGES - 1);
    expect(result.truncated).toBe(true);
    expect(result.repositories).toHaveLength((MAX_REPOSITORY_PAGES - 1) * REPOSITORIES_PER_PAGE);
  });

  it("reads at most MAX_INSTALLATIONS installations and says so", async () => {
    const installations = Array.from({ length: MAX_INSTALLATIONS + 2 }, (_, id) => ({ id }));
    const calls = github(() => ["acme/web"], installations);
    const result = await listCoveredRepositories(GITHUB, TEST_PRIVATE_KEY);
    expect(calls.filter((call) => call.url.endsWith("/access_tokens"))).toHaveLength(
      MAX_INSTALLATIONS,
    );
    expect(result.truncated).toBe(true);
  });

  it("uses a Enterprise Server API base", async () => {
    const calls = github(() => []);
    await listCoveredRepositories(
      { ...GITHUB, apiBase: "https://ghes.example.com/api/v3/" },
      TEST_PRIVATE_KEY,
    );
    expect(calls[0]?.url.startsWith("https://ghes.example.com/api/v3/app/installations")).toBe(
      true,
    );
  });

  it("names the host and status on a refusal, never the body or a credential", async () => {
    stubFetch(
      () => new Response("bad key -----BEGIN PRIVATE KEY----- ghs_secret", { status: 401 }),
    );
    const failure = await listCoveredRepositories(GITHUB, TEST_PRIVATE_KEY).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RepositoryListError);
    expect((failure as Error).message).toBe("GitHub answered HTTP 401");
  });

  it("reports a network failure as unreachable, without its message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        throw new TypeError("getaddrinfo ENOTFOUND api.github.com token=abc");
      }),
    );
    await expect(listCoveredRepositories(GITHUB, TEST_PRIVATE_KEY)).rejects.toThrow(
      "GitHub unreachable",
    );
  });

  it("fails when GitHub grants no installation token", async () => {
    stubFetch((url) =>
      url.includes("/app/installations?") ? Response.json([{ id: 1 }]) : Response.json({}),
    );
    await expect(listCoveredRepositories(GITHUB, TEST_PRIVATE_KEY)).rejects.toThrow(
      "GitHub unreachable",
    );
  });

  it("ignores entries it does not understand", async () => {
    stubFetch((url) => {
      if (url.includes("/app/installations?")) {
        return Response.json([{ id: 1 }, null, { id: "x" }]);
      }
      if (url.endsWith("/access_tokens")) {
        return Response.json({ token: "t" });
      }
      return Response.json({ repositories: [{ full_name: "a/b" }, { full_name: 5 }, null] });
    });
    const result = await listCoveredRepositories(GITHUB, TEST_PRIVATE_KEY);
    expect(result.repositories).toEqual([{ fullName: "a/b" }]);
  });
});

describe("listCoveredRepositories: GitLab", () => {
  it("lists the group's projects, subgroups included, with the token", async () => {
    const calls = stubFetch(() =>
      Response.json([{ path_with_namespace: "acme/web/b" }, { path_with_namespace: "acme/web/a" }]),
    );
    const result = await listCoveredRepositories(GITLAB, "glpat-secret");
    expect(result).toEqual({
      repositories: [{ fullName: "acme/web/a" }, { fullName: "acme/web/b" }],
      truncated: false,
    });
    expect(calls[0]?.url).toBe(
      "https://gitlab.example.com/api/v4/groups/acme%2Fweb/projects?include_subgroups=true&simple=true&archived=false&per_page=100&page=1",
    );
    expect(new Headers(calls[0]?.init.headers).get("private-token")).toBe("glpat-secret");
  });

  it("lists member projects for a token with no group", async () => {
    const calls = stubFetch(() => Response.json([]));
    await listCoveredRepositories({ ...GITLAB, config: {}, apiBase: null }, "glpat-x");
    expect(calls[0]?.url.startsWith("https://gitlab.com/api/v4/projects?membership=true")).toBe(
      true,
    );
  });

  it("stops at the page cap and says the list was cut short", async () => {
    const calls = stubFetch((url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json(
        fullPage("acme", page).map((path_with_namespace) => ({ path_with_namespace })),
      );
    });
    const result = await listCoveredRepositories(GITLAB, "glpat-x");
    expect(calls).toHaveLength(MAX_REPOSITORY_PAGES);
    expect(result.truncated).toBe(true);
    expect(result.repositories).toHaveLength(MAX_REPOSITORY_PAGES * REPOSITORIES_PER_PAGE);
  });

  it("names the host and status on a refusal, never the token", async () => {
    stubFetch(() => new Response("glpat-secret rejected", { status: 403 }));
    const failure = await listCoveredRepositories(GITLAB, "glpat-secret").catch(
      (error: unknown) => error,
    );
    expect((failure as Error).message).toBe("GitLab answered HTTP 403");
  });

  it("answers an empty, complete list for an unknown provider without asking a host", async () => {
    const calls = stubFetch(() => Response.json([]));
    await expect(
      listCoveredRepositories({ provider: "other", apiBase: null, config: {} }, "x"),
    ).resolves.toEqual({ repositories: [], truncated: false });
    expect(calls).toHaveLength(0);
  });
});
