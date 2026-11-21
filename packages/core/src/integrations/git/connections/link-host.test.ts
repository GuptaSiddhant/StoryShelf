import { afterEach, describe, expect, it, vi } from "vitest";
import { bodyOf, stubFetch } from "../test-fetch.ts";
import { TEST_PRIVATE_KEY } from "../test-key.ts";
import { BROKEN_REASONS, recheckLink, resolveLinkCoverage } from "./link-host.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const GITHUB = { provider: "github-app", apiBase: null, config: { appId: "42" } };
const GITLAB = { provider: "gitlab-token", apiBase: "https://git.example.com", config: {} };
const PINNED = { owner: "acme", repo: "web", hostRepositoryId: "9001", installationId: "777" };

const json = (body: unknown, status = 200) => Response.json(body, { status });
const status = (code: number) => new Response("{}", { status: code });

describe("resolveLinkCoverage", () => {
  it("pins a GitHub repository's id and installation", async () => {
    stubFetch((url) =>
      url.endsWith("/installation")
        ? json({ id: 777 })
        : json({ repositories: [{ id: 9001, full_name: "acme/web" }] }, 201),
    );
    expect(await resolveLinkCoverage(GITHUB, TEST_PRIVATE_KEY, PINNED)).toEqual({
      covered: true,
      hostRepositoryId: "9001",
      installationId: "777",
    });
  });

  it("answers not covered when the App is not installed", async () => {
    stubFetch(() => status(404));
    expect(await resolveLinkCoverage(GITHUB, TEST_PRIVATE_KEY, PINNED)).toEqual({
      covered: false,
    });
  });

  it("reads a GitLab project's numeric id by its path", async () => {
    const calls = stubFetch(() => json({ id: 55 }));
    expect(await resolveLinkCoverage(GITLAB, "glpat", { owner: "grp/sub", repo: "web" })).toEqual({
      covered: true,
      hostRepositoryId: "55",
      installationId: null,
    });
    expect(calls[0]?.url).toBe("https://git.example.com/api/v4/projects/grp%2Fsub%2Fweb");
    expect(calls[0]?.init.headers).toMatchObject({ "PRIVATE-TOKEN": "glpat" });
  });

  it("answers not covered for a GitLab 404 and an unknown provider; throws on a 5xx", async () => {
    stubFetch(() => status(404));
    expect(await resolveLinkCoverage(GITLAB, "t", PINNED)).toEqual({ covered: false });
    expect(await resolveLinkCoverage({ ...GITLAB, provider: "x" }, "t", PINNED)).toEqual({
      covered: false,
    });
    stubFetch(() => json({ name: "no id" }));
    await expect(resolveLinkCoverage(GITLAB, "t", PINNED)).rejects.toThrow("project id");
  });
});

describe("recheckLink on GitHub", () => {
  it("holds when the installation still grants a token for the pinned id", async () => {
    const calls = stubFetch(() => json({ token: "ghs_dropped" }, 201));
    expect(await recheckLink(GITHUB, TEST_PRIVATE_KEY, PINNED)).toEqual({
      ok: true,
      hostRepositoryId: "9001",
      installationId: "777",
    });
    expect(calls[0]?.url).toBe("https://api.github.com/app/installations/777/access_tokens");
    expect(bodyOf(calls[0])).toEqual({
      repository_ids: [9001],
      permissions: { metadata: "read" },
    });
  });

  it("breaks when the installation no longer covers the id (422)", async () => {
    stubFetch(() => status(422));
    expect(await recheckLink(GITHUB, TEST_PRIVATE_KEY, PINNED)).toEqual({
      ok: false,
      reason: BROKEN_REASONS.uncovered,
    });
  });

  it("follows a replaced installation that covers the same id", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("/installations/777/")) return status(404);
      if (url.endsWith("/installation")) return json({ id: 888 });
      return json({ token: "t" }, 201);
    });
    expect(await recheckLink(GITHUB, TEST_PRIVATE_KEY, PINNED)).toEqual({
      ok: true,
      hostRepositoryId: "9001",
      installationId: "888",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/app/installations/777/access_tokens",
      "https://api.github.com/repos/acme/web/installation",
      "https://api.github.com/app/installations/888/access_tokens",
    ]);
  });

  it("breaks when the App is uninstalled, or the new installation misses the id", async () => {
    stubFetch(() => status(404));
    expect(await recheckLink(GITHUB, TEST_PRIVATE_KEY, PINNED)).toEqual({
      ok: false,
      reason: BROKEN_REASONS.uninstalled,
    });
    stubFetch((url) => {
      if (url.includes("/installations/777/")) return status(404);
      if (url.endsWith("/installation")) return json({ id: 888 });
      return status(422);
    });
    expect(await recheckLink(GITHUB, TEST_PRIVATE_KEY, PINNED)).toEqual({
      ok: false,
      reason: BROKEN_REASONS.uncovered,
    });
  });

  it("resolves a link that pinned nothing yet (approved by configuration)", async () => {
    stubFetch(() => status(404));
    const unpinned = { ...PINNED, hostRepositoryId: null, installationId: null };
    expect(await recheckLink(GITHUB, TEST_PRIVATE_KEY, unpinned)).toEqual({
      ok: false,
      reason: BROKEN_REASONS.uninstalled,
    });
    stubFetch((url) =>
      url.endsWith("/installation")
        ? json({ id: 5 })
        : json({ repositories: [{ id: 6, full_name: "acme/web" }] }, 201),
    );
    expect(await recheckLink(GITHUB, TEST_PRIVATE_KEY, unpinned)).toEqual({
      ok: true,
      hostRepositoryId: "6",
      installationId: "5",
    });
  });

  it("is inconclusive on a 5xx, a refused App JWT or a network error", async () => {
    for (const respond of [() => status(503), () => status(401)]) {
      stubFetch(respond);
      // oxlint-disable-next-line no-await-in-loop -- each answer is checked on its own stub
      await expect(recheckLink(GITHUB, TEST_PRIVATE_KEY, PINNED)).rejects.toThrow();
    }
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(recheckLink(GITHUB, TEST_PRIVATE_KEY, PINNED)).rejects.toThrow();
  });
});

describe("recheckLink on GitLab", () => {
  it("holds while the token reads the pinned project id", async () => {
    const calls = stubFetch(() => json({ id: 9001 }));
    expect(await recheckLink(GITLAB, "t", PINNED)).toMatchObject({ ok: true });
    expect(calls[0]?.url).toBe("https://git.example.com/api/v4/projects/9001");
  });

  it("breaks on 404 (gone) and on 401 or 403 (token refused)", async () => {
    stubFetch(() => status(404));
    expect(await recheckLink(GITLAB, "t", PINNED)).toEqual({
      ok: false,
      reason: BROKEN_REASONS.gitlabGone,
    });
    for (const code of [401, 403]) {
      stubFetch(() => status(code));
      // oxlint-disable-next-line no-await-in-loop -- each answer is checked on its own stub
      expect(await recheckLink(GITLAB, "t", PINNED)).toEqual({
        ok: false,
        reason: BROKEN_REASONS.gitlabToken,
      });
    }
  });

  it("is inconclusive on a 5xx; an unknown provider is broken", async () => {
    stubFetch(() => status(500));
    await expect(recheckLink(GITLAB, "t", PINNED)).rejects.toThrow();
    expect(await recheckLink({ ...GITLAB, provider: "x" }, "t", PINNED)).toEqual({
      ok: false,
      reason: BROKEN_REASONS.unknownProvider,
    });
  });
});
