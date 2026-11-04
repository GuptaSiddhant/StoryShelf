/** GitHub rulesets: the required status checks that apply to a branch (REST API, admin token). */
import {
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
  rules?: { type: string; parameters?: Record<string, unknown> }[];
}

/** Everything a ruleset call needs. */
export interface RulesCtx {
  repo: string;
  fetchImpl: Fetch;
  headers: Record<string, string>;
}

/** The name of the ruleset created when none applies. */
export const RULESET_NAME = "StoryShelf merge gate";

/** The active rules that apply to the branch, from every ruleset (repository and organization). */
export async function appliedRules(ctx: RulesCtx, branch: string): Promise<BranchRule[]> {
  const url = `${API}/repos/${ctx.repo}/rules/branches/${encodeURIComponent(branch)}`;
  return await hostJson<BranchRule[]>(ctx.fetchImpl, url, { headers: ctx.headers });
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
  const rules = (ruleset.rules ?? []).map((rule) =>
    rule.type === "required_status_checks" ? withChecks(rule, what.missing) : rule,
  );
  await hostJson(ctx.fetchImpl, url, { method: "PUT", headers: ctx.headers, json: { rules } });
  return `Added required checks to the ruleset "${ruleset.name}": ${what.missing.join(", ")}.`;
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
      name: RULESET_NAME,
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
  return `Created the ruleset "${RULESET_NAME}" on ${target.branch} requiring ${target.checks.join(", ")}.`;
}
