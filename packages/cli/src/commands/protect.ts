import { printError, printLine } from "../output.ts";
import { githubProtection } from "./protect-github.ts";
import { gitlabProtection } from "./protect-gitlab.ts";
import type { Fetch, ProtectionAdapter, ProtectionResult } from "./protect-types.ts";

/** Options for the `protect` command. */
export interface ProtectOptions {
  /** Git host: `github` or `gitlab`. */
  provider: string;
  /** `owner/repo` on GitHub, `group/project` on GitLab. */
  repo: string;
  /** Branch merges must be gated on (default `main`). */
  branch?: string;
  /** The channel's status prefix (default `storyshelf`). */
  prefix?: string;
  /** The gate: `testing` (default) or `review` (a project with testing off). */
  gate?: string;
  /** Self-managed GitLab host, e.g. `https://gitlab.example.com`. */
  host?: string;
  /** Admin token (or GITHUB_TOKEN / GITLAB_TOKEN env). */
  token?: string;
  /** Write the rule. Without it nothing is changed. */
  apply?: boolean;
  /** Test seam for `fetch`. */
  fetch?: Fetch;
}

/** The check names a merge must wait for: the channel's gate status. */
export function requiredChecks(prefix: string, gate: string): string[] {
  return [`${prefix}/${gate}`];
}

/**
 * Print the exact required-check rule for the host, validate the branch's existing rule against
 * it, and write the missing part only with `--apply` (dry run by default). Never reads or writes
 * anything but the branch protection of one repository.
 */
export async function runProtect(options: ProtectOptions): Promise<void> {
  const adapter = adapterFor(options);
  const checks = requiredChecks(options.prefix ?? "storyshelf", options.gate ?? "testing");
  const target = { branch: options.branch ?? "main", checks };
  for (const line of adapter.manualSteps(target)) {
    printLine(line);
  }
  const token = options.token ?? process.env[adapter.tokenEnv];
  if (token) {
    await validateAndApply(adapter.inspect(target, token), options.apply === true);
  } else if (options.apply) {
    throw new Error(`--apply needs an admin token (--token or ${adapter.tokenEnv})`);
  } else {
    printLine(
      `\nNo token: rule not checked. Pass --token (or ${adapter.tokenEnv}) to validate it.`,
    );
  }
}

/** Print what the rule lacks; write it when `apply`, else say it was a dry run. */
async function validateAndApply(
  inspected: Promise<ProtectionResult>,
  apply: boolean,
): Promise<void> {
  const result = await inspected;
  printLine(`\n${result.summary}`);
  if (result.satisfied) {
    return;
  }
  process.exitCode = 1;
  if (!apply) {
    printLine("Dry run: nothing was changed. Run again with --apply to write the rule.");
  } else if (result.apply === undefined) {
    printError("This rule cannot be written automatically; follow the steps above.");
  } else {
    printLine(await result.apply());
    process.exitCode = undefined;
  }
}

function adapterFor(options: ProtectOptions): ProtectionAdapter {
  const fetchImpl = options.fetch ?? fetch;
  if (options.provider === "github") {
    return githubProtection(options.repo, fetchImpl);
  }
  if (options.provider === "gitlab") {
    return gitlabProtection(options.repo, options.host ?? "https://gitlab.com", fetchImpl);
  }
  throw new Error(`Unknown provider "${options.provider}": use github or gitlab`);
}
