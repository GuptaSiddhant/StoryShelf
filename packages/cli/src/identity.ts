/**
 * The identity of an upload (#1406): which commit, branch, message and author a build is recorded
 * under, and where each value came from. Per field the order is flags, then the CI provider
 * ({@link detectCi}), then local git, then (sha and branch only) a synthesized local identity, so a
 * checkout without git still uploads with no flags. Message and author prefer the commit as git
 * records it, then the provider's own variables.
 */
import {
  gitBranchName,
  gitHeadSha,
  gitRepoStatus,
  LOCAL_BRANCH,
  localSha,
} from "@storyshelf/affected";
import { detectCi, type CiIdentity, type Sourced } from "./ci-env.ts";
import { gitCommitInfo, type CommitInfo } from "./git-commit.ts";

/** Git probe for identity auto-detection; injectable for tests. */
export interface GitIdentityProbe {
  headSha: (cwd: string) => string | null;
  branchName: (cwd: string) => string | null;
  /** Message and author of a commit available locally (defaults to `git log -1`). */
  commitInfo?: (cwd: string, sha: string) => CommitInfo | null;
}

/** The flags that name part of the identity. */
export interface IdentityFlags {
  sha?: string | undefined;
  branch?: string | undefined;
  message?: string | undefined;
  authorName?: string | undefined;
  authorEmail?: string | undefined;
}

/** Resolved sha/branch plus whether either was synthesized locally. */
export interface ResolvedIdentity {
  sha: string;
  branch: string;
  synthesized: boolean;
}

/** An identity with the source of each value, for the upload and for `doctor`. */
export interface UploadIdentity extends ResolvedIdentity {
  message?: string;
  authorName?: string;
  authorEmail?: string;
  /** The detected CI provider's name, or null outside CI. */
  provider: string | null;
  /** Where each resolved value came from, for example `GitHub pull_request: GITHUB_HEAD_REF`. */
  sources: Readonly<Record<string, string>>;
  /** The pull or merge request number, when the provider knows it (shown, not sent). */
  pullRequest?: Sourced;
  /** The branch the pull or merge request targets, when known (shown, not sent). */
  baseBranch?: Sourced;
  /** Things that make the identity less reliable than it looks. */
  warnings: string[];
}

/** Injectable inputs of the resolution. */
export interface IdentityDeps {
  probe?: GitIdentityProbe;
  /** The CI identity; defaults to {@link detectCi}. `null` means outside CI. */
  ci?: CiIdentity | null;
}

const SYNTHESIZED = "synthesized";

const defaultProbe: GitIdentityProbe = {
  headSha: gitHeadSha,
  branchName: gitBranchName,
  commitInfo: gitCommitInfo,
};

/** The first defined candidate. */
function firstSourced(...candidates: (Sourced | undefined)[]): Sourced | undefined {
  return candidates.find((candidate) => candidate !== undefined);
}

/** A value with its source, or undefined for a missing value. */
function sourced(value: string | undefined | null, source: string): Sourced | undefined {
  return value === undefined || value === null || value === "" ? undefined : { value, source };
}

/** A flag's value, labelled with the flag. */
function flag(value: string | undefined, name: string): Sourced | undefined {
  return sourced(value, `flag ${name}`);
}

/** A value read from `git log -1`. */
function fromLog(value: string | undefined): Sourced | undefined {
  return sourced(value, "local git (git log -1)");
}

/** Message and author: flags, then the commit in local git, then the provider's variables. */
function resolveCommitFields(
  cwd: string,
  sha: Sourced | undefined,
  flags: IdentityFlags,
  ci: CiIdentity | null,
  probe: GitIdentityProbe,
): Pick<UploadIdentity, "message" | "authorName" | "authorEmail" | "sources"> {
  const info = sha === undefined ? null : (probe.commitInfo?.(cwd, sha.value) ?? null);
  const fields = {
    message: firstSourced(flag(flags.message, "--message"), fromLog(info?.message), ci?.message),
    authorName: firstSourced(
      flag(flags.authorName, "--author-name"),
      fromLog(info?.authorName),
      ci?.authorName,
    ),
    authorEmail: firstSourced(
      flag(flags.authorEmail, "--author-email"),
      fromLog(info?.authorEmail),
      ci?.authorEmail,
    ),
  };
  return {
    ...(fields.message && { message: fields.message.value }),
    ...(fields.authorName && { authorName: fields.authorName.value }),
    ...(fields.authorEmail && { authorEmail: fields.authorEmail.value }),
    sources: Object.fromEntries(
      Object.entries(fields).flatMap(([key, value]) => (value ? [[key, value.source]] : [])),
    ),
  };
}

/**
 * Resolve the full upload identity. Synthesis always succeeds, so a checkout without git uploads
 * with zero identity flags.
 *
 * @param cwd - Project directory, for local git.
 * @param flags - The identity flags the user passed.
 * @param deps - Git probe and CI identity (test seams).
 */
export function resolveUploadIdentity(
  cwd: string,
  flags: IdentityFlags,
  deps: IdentityDeps = {},
): UploadIdentity {
  const probe = deps.probe ?? defaultProbe;
  const ci = deps.ci === undefined ? detectCi() : deps.ci;
  const sha = firstSourced(flag(flags.sha, "--sha"), ci?.sha);
  const branch = firstSourced(flag(flags.branch, "--branch"), ci?.branch);
  const resolvedSha: Sourced = sha ??
    sourced(probe.headSha(cwd), "local git (HEAD)") ?? { value: localSha(), source: SYNTHESIZED };
  const resolvedBranch: Sourced = branch ??
    sourced(probe.branchName(cwd), "local git (current branch)") ?? {
      value: LOCAL_BRANCH,
      source: SYNTHESIZED,
    };
  const commit = resolveCommitFields(
    cwd,
    resolvedSha.source === SYNTHESIZED ? undefined : resolvedSha,
    flags,
    ci,
    probe,
  );
  return {
    sha: resolvedSha.value,
    branch: resolvedBranch.value,
    synthesized: resolvedSha.source === SYNTHESIZED || resolvedBranch.source === SYNTHESIZED,
    provider: ci?.provider ?? null,
    ...commit,
    sources: {
      sha: resolvedSha.source,
      branch: resolvedBranch.source,
      ...commit.sources,
    },
    ...(ci?.pullRequest && { pullRequest: ci.pullRequest }),
    ...(ci?.baseBranch && { baseBranch: ci.baseBranch }),
    warnings: [...(ci?.warnings ?? [])],
  };
}

/** The three values of the older resolution, for callers that need no sources. */
export function resolveIdentity(
  cwd: string,
  options: Pick<IdentityFlags, "sha" | "branch">,
  probe?: GitIdentityProbe,
): ResolvedIdentity {
  const { sha, branch, synthesized } = resolveUploadIdentity(cwd, options, {
    ...(probe && { probe }),
  });
  return { sha, branch, synthesized };
}

/** `name: value (source)`, or nothing for a missing value. */
function describeLine(
  name: string,
  value: string | undefined,
  source: string | undefined,
): string[] {
  return value === undefined ? [] : [`${name}: ${value}${source ? ` (${source})` : ""}`];
}

/** The first line of a possibly multi-line text. */
function firstLine(text: string | undefined): string | undefined {
  return text?.split("\n")[0];
}

/** One line per resolved value with its source, never a token: `branch: x (GitHub push: GITHUB_REF_NAME)`. */
export function describeIdentity(identity: UploadIdentity): string[] {
  return [
    ...(identity.provider ? [`CI provider: ${identity.provider}`] : []),
    ...describeLine("sha", identity.sha, identity.sources["sha"]),
    ...describeLine("branch", identity.branch, identity.sources["branch"]),
    ...describeLine("message", firstLine(identity.message), identity.sources["message"]),
    ...describeLine("author", identity.authorName, identity.sources["authorName"]),
    ...describeLine("author email", identity.authorEmail, identity.sources["authorEmail"]),
    ...describeLine("pull request", identity.pullRequest?.value, identity.pullRequest?.source),
    ...describeLine("base branch", identity.baseBranch?.value, identity.baseBranch?.source),
  ];
}

/** Whether the clone is shallow, so affected capture and `--skip-unchanged` cannot diff. */
export function isShallowClone(cwd: string): boolean {
  return gitRepoStatus(cwd) === "shallow";
}
