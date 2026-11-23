import { afterEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../test-fetch.ts";
import { TEST_PRIVATE_KEY } from "../test-key.ts";
import { gitConnectionHealth, gitlabTokenExpiry } from "./health.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = Date.parse("2026-11-20T10:00:00Z");
const GITHUB = { provider: "github-app", apiBase: null, config: { appId: "42" } };
const gitlab = (expiresOn: string) => ({
  provider: "gitlab-token",
  apiBase: "https://gitlab.example.com",
  config: { expiresOn },
});

describe("gitConnectionHealth: GitHub", () => {
  it("is ok when GitHub answers GET /app with the App's JWT", async () => {
    const calls = stubFetch(() => Response.json({ slug: "storyshelf-acme" }));
    await expect(gitConnectionHealth(GITHUB, TEST_PRIVATE_KEY, { now: NOW })).resolves.toEqual({
      ok: true,
      detail: "App storyshelf-acme",
    });
    expect(calls[0]?.url).toBe("https://api.github.com/app");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toMatch(/^Bearer eyJ/u);
  });

  it("reports a refusal by status only, never the body", async () => {
    stubFetch(() => new Response("bad key -----BEGIN PRIVATE KEY-----", { status: 401 }));
    const health = await gitConnectionHealth(
      { ...GITHUB, apiBase: "https://ghes.example.com/api/v3" },
      TEST_PRIVATE_KEY,
      { now: NOW },
    );
    expect(health).toEqual({ ok: false, detail: "GitHub answered HTTP 401" });
  });

  it("reports a network failure as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        throw new TypeError("getaddrinfo ENOTFOUND api.github.com token=abc");
      }),
    );
    const health = await gitConnectionHealth(GITHUB, TEST_PRIVATE_KEY, {
      now: NOW,
      signal: new AbortController().signal,
    });
    expect(health).toEqual({ ok: false, detail: "GitHub unreachable" });
  });
});

describe("gitConnectionHealth: GitLab", () => {
  it("is ok for an active token far from expiry", async () => {
    const calls = stubFetch(() => Response.json({ active: true, revoked: false }));
    await expect(
      gitConnectionHealth(gitlab("2027-06-01"), "glpat-x", { now: NOW }),
    ).resolves.toEqual({ ok: true, detail: "Token active" });
    expect(calls[0]?.url).toBe("https://gitlab.example.com/api/v4/personal_access_tokens/self");
    expect(new Headers(calls[0]?.init.headers).get("private-token")).toBe("glpat-x");
  });

  it("warns 30 days before the token expires", async () => {
    stubFetch(() => Response.json({ active: true }));
    const health = await gitConnectionHealth(gitlab("2026-12-10"), "glpat-x", { now: NOW });
    expect(health).toEqual({
      ok: true,
      detail: "Token active",
      warning: "Token expires on 2026-12-10 (in 20 days)",
    });
  });

  it("is not ok once the token expired, without asking GitLab", async () => {
    const calls = stubFetch(() => Response.json({ active: true }));
    const health = await gitConnectionHealth(gitlab("2026-11-20"), "glpat-x", { now: NOW });
    expect(health).toEqual({ ok: false, detail: "Token expired on 2026-11-20" });
    expect(calls).toHaveLength(0);
  });

  it("is not ok for a revoked token or a refusal", async () => {
    stubFetch(() => Response.json({ active: false, revoked: true }));
    await expect(
      gitConnectionHealth(gitlab("2027-06-01"), "glpat-x", { now: NOW }),
    ).resolves.toEqual({ ok: false, detail: "Token is revoked or inactive" });
    stubFetch(() => new Response("401 Unauthorized glpat-x", { status: 401 }));
    await expect(
      gitConnectionHealth(gitlab("2027-06-01"), "glpat-x", { now: NOW }),
    ).resolves.toEqual({ ok: false, detail: "GitLab answered HTTP 401" });
  });

  it("refuses an unknown provider", async () => {
    await expect(
      gitConnectionHealth({ provider: "svn", apiBase: null, config: {} }, "s"),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("gitlabTokenExpiry", () => {
  it("is fine beyond 30 days, warns within, expires on the day", () => {
    expect(gitlabTokenExpiry("2027-01-01", NOW)).toEqual({ expired: false });
    expect(gitlabTokenExpiry("2026-12-20", NOW)).toEqual({
      expired: false,
      message: "Token expires on 2026-12-20 (in 30 days)",
    });
    expect(gitlabTokenExpiry("2026-11-20", NOW).expired).toBe(true);
    expect(gitlabTokenExpiry(undefined, NOW)).toEqual({
      expired: false,
      message: "Token expiry unknown",
    });
  });
});
