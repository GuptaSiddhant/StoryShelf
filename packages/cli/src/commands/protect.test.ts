import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fetch } from "./protect-types.ts";
import { runProtect, requiredChecks, type ProtectOptions } from "./protect.ts";

interface Call {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/** A recorded host: `answers` maps "METHOD path" to [status, json]; unknown routes answer 404. */
function host(answers: Record<string, [number, unknown]>): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    await Promise.resolve();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    calls.push({
      method,
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: init?.headers as Record<string, string>,
    });
    const [status, json] = answers[`${method} ${new URL(url).pathname}`] ?? [
      404,
      { message: "Not Found" },
    ];
    return Response.json(json, { status });
  };
  return { fetch: fake as Fetch, calls };
}

let out: string;
beforeEach(() => {
  out = "";
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.stubEnv("GITLAB_TOKEN", "");
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  process.exitCode = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

const GH = {
  provider: "github",
  repo: "acme/widgets",
  token: "ghp_admin",
} satisfies ProtectOptions;
const PROTECTION = "/repos/acme/widgets/branches/main/protection";
const writes = (calls: Call[]) => calls.filter((call) => call.method !== "GET");

describe("requiredChecks", () => {
  it("is the channel's gate status", () => {
    expect(requiredChecks("storyshelf", "testing")).toEqual(["storyshelf/testing"]);
    expect(requiredChecks("web", "review")).toEqual(["web/review"]);
  });
});

describe("storyshelf protect (GitHub)", () => {
  it("prints the exact rule and the manual steps without a token", async () => {
    const recorded = host({});
    await runProtect({ provider: "github", repo: "acme/widgets", fetch: recorded.fetch });
    expect(out).toContain("  - storyshelf/testing");
    expect(out).toContain("https://github.com/acme/widgets/settings/branches");
    expect(out).toContain("rule not checked");
    expect(recorded.calls).toEqual([]);
  });

  it.each([
    ["a status", { contexts: ["storyshelf/testing"], checks: [] }],
    ["a check run", { contexts: [], checks: [{ context: "storyshelf/testing", app_id: 1 }] }],
  ])("passes when the rule already requires the check as %s", async (_kind, checks) => {
    const recorded = host({ [`GET ${PROTECTION}/required_status_checks`]: [200, checks] });
    await runProtect({ ...GH, fetch: recorded.fetch });
    expect(out).toContain("OK: main already requires storyshelf/testing");
    expect(writes(recorded.calls)).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it("reports a missing check as a dry run and writes nothing", async () => {
    const recorded = host({
      [`GET ${PROTECTION}/required_status_checks`]: [200, { contexts: ["ci/build"], checks: [] }],
    });
    await runProtect({ ...GH, fetch: recorded.fetch });
    expect(out).toContain("does not require: storyshelf/testing (it requires ci/build)");
    expect(out).toContain("Dry run: nothing was changed");
    expect(writes(recorded.calls)).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(recorded.calls[0]?.headers["authorization"]).toBe("Bearer ghp_admin");
  });

  it("adds only the missing check with --apply and keeps the others", async () => {
    const recorded = host({
      [`GET ${PROTECTION}/required_status_checks`]: [200, { contexts: ["ci/build"], checks: [] }],
      [`POST ${PROTECTION}/required_status_checks/contexts`]: [
        200,
        ["ci/build", "storyshelf/testing"],
      ],
    });
    await runProtect({ ...GH, apply: true, fetch: recorded.fetch });
    expect(writes(recorded.calls)).toMatchObject([
      { method: "POST", body: ["storyshelf/testing"] },
    ]);
    expect(out).toContain("Added required checks: storyshelf/testing.");
  });

  it("creates a rule on an unprotected branch only with --apply", async () => {
    const answers = {
      [`GET ${PROTECTION}/required_status_checks`]: [404, { message: "Branch not protected" }],
      [`PUT ${PROTECTION}`]: [200, {}],
    } as Record<string, [number, unknown]>;
    const dry = host(answers);
    await runProtect({ ...GH, fetch: dry.fetch });
    expect(out).toContain("has no protection rule");
    expect(writes(dry.calls)).toEqual([]);
    const applied = host(answers);
    await runProtect({ ...GH, apply: true, fetch: applied.fetch });
    expect(writes(applied.calls)).toMatchObject([
      {
        method: "PUT",
        body: {
          required_status_checks: { strict: false, contexts: ["storyshelf/testing"] },
          enforce_admins: false,
          required_pull_request_reviews: null,
          restrictions: null,
        },
      },
    ]);
  });

  it("will not rewrite a protected branch that requires no checks", async () => {
    const recorded = host({
      [`GET ${PROTECTION}/required_status_checks`]: [
        404,
        { message: "Required status checks not enabled" },
      ],
    });
    await runProtect({ ...GH, apply: true, fetch: recorded.fetch });
    expect(out).toContain("requires no status checks");
    expect(writes(recorded.calls)).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("honours --branch, --prefix and --gate", async () => {
    const recorded = host({
      "GET /repos/acme/widgets/branches/release%2F1/protection/required_status_checks": [
        200,
        { contexts: ["web/review"] },
      ],
    });
    await runProtect({
      ...GH,
      branch: "release/1",
      prefix: "web",
      gate: "review",
      fetch: recorded.fetch,
    });
    expect(out).toContain("OK: release/1 already requires web/review");
  });

  it("surfaces an API failure other than 404", async () => {
    const recorded = host({
      [`GET ${PROTECTION}/required_status_checks`]: [403, { message: "no" }],
    });
    await expect(runProtect({ ...GH, fetch: recorded.fetch })).rejects.toThrow("403");
  });

  it("needs a token to apply and a valid repo and provider", async () => {
    await expect(
      runProtect({ provider: "github", repo: "acme/widgets", apply: true, fetch: host({}).fetch }),
    ).rejects.toThrow("--apply needs an admin token");
    await expect(runProtect({ ...GH, repo: "nope" })).rejects.toThrow("owner/repo");
    await expect(runProtect({ ...GH, provider: "bitbucket" })).rejects.toThrow("Unknown provider");
  });
});

describe("storyshelf protect (GitLab)", () => {
  const GL = { provider: "gitlab", repo: "grp/app", token: "glpat-x" } satisfies ProtectOptions;
  const PROJECT = "/api/v4/projects/grp%2Fapp";

  it("says it is merge-gated by the pipeline setting and validates it", async () => {
    const recorded = host({
      [`GET ${PROJECT}`]: [200, { only_allow_merge_if_pipeline_succeeds: true }],
      [`GET ${PROJECT}/protected_branches/main`]: [200, {}],
    });
    await runProtect({ ...GL, fetch: recorded.fetch });
    expect(out).toContain("Pipelines must succeed");
    expect(out).toContain("Pipelines must succeed is on.");
    expect(recorded.calls[0]?.headers["private-token"]).toBe("glpat-x");
    expect(process.exitCode).toBeUndefined();
  });

  it("turns the setting on only with --apply", async () => {
    const answers = {
      [`GET ${PROJECT}`]: [200, { only_allow_merge_if_pipeline_succeeds: false }],
      [`PUT ${PROJECT}`]: [200, {}],
    } as Record<string, [number, unknown]>;
    const dry = host(answers);
    await runProtect({ ...GL, host: "https://gitlab.example.com/", fetch: dry.fetch });
    expect(dry.calls[0]?.url).toBe(`https://gitlab.example.com${PROJECT}`);
    expect(out).toContain("is off");
    expect(writes(dry.calls)).toEqual([]);
    const applied = host(answers);
    await runProtect({ ...GL, apply: true, fetch: applied.fetch });
    expect(writes(applied.calls)).toMatchObject([
      { method: "PUT", body: { only_allow_merge_if_pipeline_succeeds: true } },
    ]);
    expect(out).toContain('Turned on "Pipelines must succeed".');
    expect(out).toContain("Branch main is not protected");
  });
});
