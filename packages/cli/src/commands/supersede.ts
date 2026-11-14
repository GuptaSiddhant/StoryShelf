import { spawnSync } from "node:child_process";
import type { createClient } from "../client.ts";
import { RequestError } from "../client.ts";
import { printLine } from "../output.ts";

/** One in-flight build of the branch, as the server lists it. */
export interface InFlightBuild {
  id: string;
  sha: string;
}

/** Outcome of one git call: its exit status and trimmed stdout (`status` is -1 when git cannot run). */
interface GitResult {
  status: number;
  stdout: string;
}

/** Runs git in a directory; injectable so the decision can be tested without a repository. */
export type GitRunner = (cwd: string, args: string[]) => GitResult;

const runGit: GitRunner = (cwd, args) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 20_000 });
  return { status: result.status ?? -1, stdout: (result.stdout ?? "").trim() };
};

/** Ids to send as `supersedes`, plus how many builds were kept because of a missing commit. */
export interface SupersedeDecision {
  superseded: string[];
  undecided: number;
}

/**
 * Decide which in-flight builds the build of `headSha` replaces (ADR 0045, decision 2).
 *
 * Superseded: a strict ancestor of `headSha`, or a commit missing locally while `headSha` is the
 * remote tip of `branch` (force-pushed away). Kept: the same commit, a descendant (a re-run of an
 * old commit), a missing commit when the tip is not `headSha` or cannot be read, and any git error.
 */
export function decideSuperseded(
  builds: InFlightBuild[],
  options: { cwd: string; branch: string; headSha: string; git?: GitRunner },
): SupersedeDecision {
  const git = options.git ?? runGit;
  let tipIsHead: boolean | undefined;
  const isTip = (): boolean => (tipIsHead ??= remoteTipIs(git, options));
  const verdicts = builds
    .filter((build) => build.sha !== options.headSha)
    .map((build) => ({ id: build.id, verdict: judge(git, options, build.sha, isTip) }));
  return {
    superseded: verdicts.filter((v) => v.verdict === "superseded").map((v) => v.id),
    undecided: verdicts.filter((v) => v.verdict === "undecided").length,
  };
}

type Verdict = "superseded" | "kept" | "undecided";

function judge(
  git: GitRunner,
  options: { cwd: string; headSha: string },
  sha: string,
  isTip: () => boolean,
): Verdict {
  const present = git(options.cwd, ["cat-file", "-e", `${sha}^{commit}`]);
  if (present.status === 0) {
    const ancestry = git(options.cwd, ["merge-base", "--is-ancestor", sha, options.headSha]);
    return ancestry.status === 0 ? "superseded" : "kept";
  }
  if (present.status !== 1 && present.status !== 128) {
    return "kept";
  }
  return isTip() ? "superseded" : "undecided";
}

/** True only when `git ls-remote origin` answers `headSha` for the branch's tip. */
function remoteTipIs(
  git: GitRunner,
  options: { cwd: string; branch: string; headSha: string },
): boolean {
  const result = git(options.cwd, ["ls-remote", "origin", `refs/heads/${options.branch}`]);
  if (result.status !== 0) {
    return false;
  }
  return result.stdout.split("\n").some((line) => line.split(/\s+/u)[0] === options.headSha);
}

/**
 * Ask the server for the branch's in-flight builds and return the ids this upload supersedes.
 * Never throws: a 404 (an old server, or testing off), any other failure, or any git error sends
 * nothing and the upload carries on.
 */
export async function findSupersedes(
  client: ReturnType<typeof createClient>,
  options: { slug: string; cwd: string; branch: string; headSha: string; git?: GitRunner },
): Promise<string[] | undefined> {
  try {
    const inFlight = await client.projects.builds.inFlight(options.slug, options.branch);
    const decision = decideSuperseded(inFlight, options);
    announce(decision);
    return decision.superseded.length > 0 ? decision.superseded : undefined;
  } catch (error) {
    if (!(error instanceof RequestError && error.status === 404)) {
      const reason = error instanceof Error ? error.message : String(error);
      printLine(`Superseded builds not checked: ${reason}`);
    }
    return undefined;
  }
}

function announce({ superseded, undecided }: SupersedeDecision): void {
  const line = describeSupersede(superseded.length, undecided);
  if (line) {
    printLine(line);
  }
}

function describeSupersede(superseded: number, undecided: number): string {
  if (superseded > 0) {
    return `Superseding ${superseded} older in-flight ${superseded === 1 ? "build" : "builds"} on this branch`;
  }
  return undecided > 0
    ? `Could not tell if ${undecided} in-flight ${undecided === 1 ? "build is" : "builds are"} superseded (commit not in this clone, and HEAD is not the remote tip); keeping them`
    : "";
}
