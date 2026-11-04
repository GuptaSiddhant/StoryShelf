/** GitHub rulesets: the required status checks that apply to a branch (REST API, admin token). */
import {
  HostError,
  hostJson,
  type Fetch,
  type ProtectionResult,
  type ProtectionTarget,
} from "./protect-types.ts";

const API = "https://api.github.com";

/** One rule of `GET /repos/{repo}/rules/branches/{branch}` (the active rules that apply). */
interface BranchRule {
  type: string;
  ruleset_id?: number;
  ruleset_source_type?: string;
  ruleset_source?: string;
  parameters?: { required_status_checks?: { context: string }[] };
}

/** A ruleset as the detail endpoint returns it (only what is read or written back). */
interface Ruleset {
  id: number;
  name: string;
  conditions?: { ref_name?: { include?: string[]; exclude?: string[] } } | null;
  rules?: { type: string; parameters?: Record<string, unknown> }[];
}

/** Everything a ruleset call needs. */
export interface RulesCtx {
  repo: string;
  fetchImpl: Fetch;
  headers: Record<string, string>;
}

/** The name of the ruleset created when none applies (one per branch: names are unique per repository). */
export function rulesetName(branch: string): string {
  return `StoryShelf merge gate (${branch})`;
}

/** Rules listed per page, and the pages read before giving up. */
const RULES_PER_PAGE = 100;
const RULES_PAGES = 10;

/** The active rules that apply to the branch, from every ruleset (repository and organization), page by page. */
export async function appliedRules(ctx: RulesCtx, branch: string): Promise<BranchRule[]> {
  const base = `${API}/repos/${ctx.repo}/rules/branches/${encodeURIComponent(branch)}`;
  return await rulesPage(ctx, { base, page: 1, seen: [] });
}

async function rulesPage(
  ctx: RulesCtx,
  at: { base: string; page: number; seen: BranchRule[] },
): Promise<BranchRule[]> {
  const url = `${at.base}?per_page=${String(RULES_PER_PAGE)}&page=${String(at.page)}`;
  const rules = await hostJson<BranchRule[]>(ctx.fetchImpl, url, { headers: ctx.headers });
  if (!Array.isArray(rules)) {
    throw new HostError(502, "the rules API answered something other than a list of rules");
  }
  const seen = [...at.seen, ...rules];
  return rules.length < RULES_PER_PAGE || at.page >= RULES_PAGES
    ? seen
    : await rulesPage(ctx, { base: at.base, page: at.page + 1, seen });
}

/** Check names that rulesets already require on the branch. */
export function requiredByRules(rules: readonly BranchRule[]): string[] {
  return rules
    .filter((rule) => rule.type === "required_status_checks")
    .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
    .map((check) => check.context);
}

/** Compare the status checks the applied rulesets require with the target. */
export function compareRules(
  ctx: RulesCtx,
  rules: readonly BranchRule[],
  target: ProtectionTarget,
): ProtectionResult {
  const present = requiredByRules(rules);
  const missing = target.checks.filter((check) => !present.includes(check));
  if (missing.length === 0) {
    return {
      mechanism: "rulesets",
      satisfied: true,
      summary: `OK: a ruleset on ${target.branch} already requires ${target.checks.join(", ")}.`,
    };
  }
  return {
    mechanism: "rulesets",
    satisfied: false,
    summary: `Rulesets apply to ${target.branch}, but none requires: ${missing.join(", ")} (they require ${present.join(", ") || "no status checks"}).`,
    apply: async () => await addToRulesets(ctx, { rules, missing, target }),
  };
}

/**
 * Add the missing checks to the first repository ruleset that already has a status-check rule,
 * keeping every other rule and setting; with none, create a ruleset of our own (rulesets add up).
 */
async function addToRulesets(
  ctx: RulesCtx,
  what: { rules: readonly BranchRule[]; missing: string[]; target: ProtectionTarget },
): Promise<string> {
  const own = what.rules.find(
    (rule) =>
      rule.type === "required_status_checks" &&
      rule.ruleset_source_type === "Repository" &&
      rule.ruleset_id !== undefined,
  );
  if (own?.ruleset_id === undefined) {
    return await createRuleset(ctx, what.target);
  }
  const url = `${API}/repos/${ctx.repo}/rulesets/${String(own.ruleset_id)}`;
  const ruleset = await hostJson<Ruleset>(ctx.fetchImpl, url, { headers: ctx.headers });
  if (!targetsOnly(ruleset, what.target.branch)) {
    // A broader ruleset (all branches, the default branch, a pattern) would put the check on
    // other branches too and block their merges: leave it alone and add a ruleset of our own.
    return await createRuleset(ctx, what.target);
  }
  const rules = (ruleset.rules ?? []).map((rule) =>
    rule.type === "required_status_checks" ? withChecks(rule, what.missing) : rule,
  );
  await hostJson(ctx.fetchImpl, url, { method: "PUT", headers: ctx.headers, json: { rules } });
  return `Added required checks to the ruleset "${ruleset.name}": ${what.missing.join(", ")}.`;
}

/** Whether the ruleset names exactly this branch (and nothing else), so adding a check stays local. */
function targetsOnly(ruleset: Ruleset, branch: string): boolean {
  const include = ruleset.conditions?.ref_name?.include ?? [];
  return include.length === 1 && include[0] === `refs/heads/${branch}`;
}

/** The rule with the checks appended; its other parameters stay. */
function withChecks(
  rule: { type: string; parameters?: Record<string, unknown> },
  missing: string[],
): { type: string; parameters: Record<string, unknown> } {
  const current = (rule.parameters?.["required_status_checks"] ?? []) as { context: string }[];
  return {
    ...rule,
    parameters: {
      ...rule.parameters,
      required_status_checks: [...current, ...missing.map((context) => ({ context }))],
    },
  };
}

/** A new active ruleset on the branch that requires the checks and nothing else. */
export async function createRuleset(ctx: RulesCtx, target: ProtectionTarget): Promise<string> {
  await hostJson(ctx.fetchImpl, `${API}/repos/${ctx.repo}/rulesets`, {
    method: "POST",
    headers: ctx.headers,
    json: {
      name: rulesetName(target.branch),
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: [`refs/heads/${target.branch}`], exclude: [] } },
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: false,
            required_status_checks: target.checks.map((context) => ({ context })),
          },
        },
      ],
    },
  });
  return `Created the ruleset "${rulesetName(target.branch)}" on ${target.branch} requiring ${target.checks.join(", ")}.`;
}
