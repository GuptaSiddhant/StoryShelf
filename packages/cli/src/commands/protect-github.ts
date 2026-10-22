/** GitHub: the required status checks of a branch protection rule (REST API, admin token). */
import {
  HostError,
  hostJson,
  type Fetch,
  type ProtectionAdapter,
  type ProtectionResult,
  type ProtectionTarget,
} from "./protect-types.ts";

const API = "https://api.github.com";

interface RequiredChecks {
  contexts?: string[];
  checks?: { context: string }[];
}

/** The GitHub adapter for `owner/repo`. */
export function githubProtection(repo: string, fetchImpl: Fetch): ProtectionAdapter {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repo)) {
    throw new Error(`--repo must be owner/repo, got "${repo}"`);
  }
  return {
    tokenEnv: "GITHUB_TOKEN",
    manualSteps: (target) => manualSteps(repo, target),
    inspect: async (target, token) => await inspect({ repo, fetchImpl, token }, target),
  };
}

function manualSteps(repo: string, target: ProtectionTarget): string[] {
  return [
    `GitHub: require these checks on ${repo}, branch ${target.branch}:`,
    ...target.checks.map((check) => `  - ${check}`),
    "",
    `1. Open https://github.com/${repo}/settings/branches and edit (or add) the rule for ${target.branch}.`,
    '2. Tick "Require status checks to pass before merging".',
    "3. Search for each check above and add it (it appears once a build has posted it).",
    "4. Save. Admin token scopes: repo (classic) or Administration: write (fine-grained).",
  ];
}

interface Ctx {
  repo: string;
  fetchImpl: Fetch;
  token: string;
}

function headers(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

async function inspect(ctx: Ctx, target: ProtectionTarget): Promise<ProtectionResult> {
  const base = `${API}/repos/${ctx.repo}/branches/${encodeURIComponent(target.branch)}/protection`;
  const existing = await readChecks(ctx, base);
  if (existing === "unprotected") {
    return {
      satisfied: false,
      summary: `Branch ${target.branch} has no protection rule.`,
      apply: async () => await createRule(ctx, base, target),
    };
  }
  if (existing === "no-checks") {
    return {
      satisfied: false,
      summary: `Branch ${target.branch} is protected but requires no status checks. Add them by hand (the API cannot add them to a rule without any).`,
    };
  }
  return compare({ ctx, base, existing }, target);
}

/** Which of the target's checks the rule lacks. */
function compare(
  rule: { ctx: Ctx; base: string; existing: RequiredChecks },
  target: ProtectionTarget,
): ProtectionResult {
  const { existing } = rule;
  const present = [...(existing.contexts ?? []), ...(existing.checks ?? []).map((c) => c.context)];
  const missing = target.checks.filter((check) => !present.includes(check));
  if (missing.length === 0) {
    return {
      satisfied: true,
      summary: `OK: ${target.branch} already requires ${target.checks.join(", ")}.`,
    };
  }
  return {
    satisfied: false,
    summary: `Branch ${target.branch} does not require: ${missing.join(", ")} (it requires ${present.join(", ") || "nothing"}).`,
    apply: async () => await addChecks(rule.ctx, rule.base, missing),
  };
}

/** The branch's required checks, or why there are none. */
async function readChecks(
  ctx: Ctx,
  base: string,
): Promise<RequiredChecks | "unprotected" | "no-checks"> {
  try {
    return await hostJson<RequiredChecks>(ctx.fetchImpl, `${base}/required_status_checks`, {
      headers: headers(ctx.token),
    });
  } catch (error) {
    if (!(error instanceof HostError) || error.status !== 404) {
      throw error;
    }
    return /not protected/iu.test(error.message) ? "unprotected" : "no-checks";
  }
}

/** Add checks to a rule that already requires some; nothing else in the rule changes. */
async function addChecks(ctx: Ctx, base: string, missing: string[]): Promise<string> {
  await hostJson(ctx.fetchImpl, `${base}/required_status_checks/contexts`, {
    method: "POST",
    headers: headers(ctx.token),
    json: missing,
  });
  return `Added required checks: ${missing.join(", ")}.`;
}

/** A new rule on an unprotected branch: required checks only, nothing else restricted. */
async function createRule(ctx: Ctx, base: string, target: ProtectionTarget): Promise<string> {
  await hostJson(ctx.fetchImpl, base, {
    method: "PUT",
    headers: headers(ctx.token),
    json: {
      required_status_checks: { strict: false, contexts: target.checks },
      enforce_admins: false,
      required_pull_request_reviews: null,
      restrictions: null,
    },
  });
  return `Created a rule on ${target.branch} requiring ${target.checks.join(", ")}.`;
}
