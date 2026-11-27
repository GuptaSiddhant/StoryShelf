/**
 * What the CI provider says about the commit being built (#1406): one row per provider in
 * {@link CI_PROVIDERS}, each reading only variables its own documentation lists (the link sits
 * beside the row). Every value carries the variable it came from, so `doctor` and `upload` can show
 * where an identity came from. Nothing here throws: a missing variable or an unreadable event file
 * leaves that field unset and the caller falls to the next source (local git, then synthesis).
 *
 * Providers whose documentation could not be fetched or does not list a variable are left out
 * rather than guessed: Jenkins' `CHANGE_BRANCH` and `CHANGE_TARGET` are not in any page the project
 * could cite, so a Jenkins pull request takes its branch from local git.
 */
import { readFileSync } from "node:fs";

/** The environment a provider is read from. */
export type CiEnv = Readonly<Record<string, string | undefined>>;

/** A resolved value and where it came from, for example `GitHub pull_request: GITHUB_HEAD_REF`. */
export interface Sourced {
  value: string;
  source: string;
}

/** The identity fields a provider can supply. A field it cannot cite stays unset. */
export interface CiFields {
  sha?: Sourced | undefined;
  branch?: Sourced | undefined;
  message?: Sourced | undefined;
  authorName?: Sourced | undefined;
  authorEmail?: Sourced | undefined;
  /** The pull or merge request number; shown by `doctor`, sent nowhere (the API has no field). */
  pullRequest?: Sourced | undefined;
  /** The branch a pull or merge request targets; shown by `doctor`, sent nowhere. */
  baseBranch?: Sourced | undefined;
  /** Why a field is missing when it should not be: printed as a warning. */
  warnings?: string[] | undefined;
}

/** What a provider row resolved. */
export interface CiIdentity extends CiFields {
  /** The provider's display name, for example `GitHub Actions`. */
  provider: string;
}

/** Inputs a provider row reads: the environment and the JSON file reader (a test seam). */
export interface CiContext {
  env: CiEnv;
  readJson: (path: string) => unknown;
}

/** One provider: how to recognise it and how to read its identity. */
interface CiProvider {
  name: string;
  /** Detected when any of these variables is set and non-empty. */
  detect: readonly string[];
  resolve: (context: CiContext) => CiFields;
}

/** Value of `name`, or undefined when unset or empty. */
function valueOf(env: CiEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

/** The first of `names` that is set, with its source label, or undefined. */
function firstOf(env: CiEnv, label: string, ...names: string[]): Sourced | undefined {
  for (const name of names) {
    const value = valueOf(env, name);
    if (value !== undefined) {
      return { value, source: `${label}: ${name}` };
    }
  }
  return undefined;
}

/** `refs/heads/x` as `x`; any other value unchanged. */
function stripHeads(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

/** A sourced value with `transform` applied, or undefined. */
function mapSourced(
  sourced: Sourced | undefined,
  transform: (value: string) => string | undefined,
): Sourced | undefined {
  const value = sourced === undefined ? undefined : transform(sourced.value);
  return sourced === undefined || value === undefined || value === ""
    ? undefined
    : { value, source: sourced.source };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value at a path of keys in parsed JSON, or undefined when any step is missing. */
function at(root: unknown, ...keys: string[]): unknown {
  let current = root;
  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

/** A non-empty string, or undefined. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A positive integer rendered as a string, or undefined. */
function count(value: unknown): string | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? String(value)
    : undefined;
}

/** Read and parse a JSON file; undefined on any failure (a missing file is not an error). */
export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/** The event payload GitHub Actions wrote for this run, or undefined. */
function githubPayload({ env, readJson }: CiContext): unknown {
  const path = valueOf(env, "GITHUB_EVENT_PATH");
  return path === undefined ? undefined : readJson(path);
}

/** A sourced value from the event payload, labelled with the event and the field path. */
function fromPayload(event: string, value: string | undefined, path: string): Sourced | undefined {
  return value === undefined
    ? undefined
    : { value, source: `GitHub ${event}: GITHUB_EVENT_PATH ${path}` };
}

/**
 * `pull_request` and `pull_request_target`: GITHUB_SHA is a merge commit (or the default branch's
 * tip) and GITHUB_REF_NAME is `<n>/merge`, so neither is read. The head commit is in the payload.
 * https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
 * https://docs.github.com/en/actions/reference/workflows-and-actions/variables
 */
function githubPullRequest(context: CiContext, event: string): CiFields {
  const payload = githubPayload(context);
  const sha = fromPayload(
    event,
    text(at(payload, "pull_request", "head", "sha")),
    "pull_request.head.sha",
  );
  const label = `GitHub ${event}`;
  return {
    sha,
    branch:
      firstOf(context.env, label, "GITHUB_HEAD_REF") ??
      fromPayload(event, text(at(payload, "pull_request", "head", "ref")), "pull_request.head.ref"),
    pullRequest: fromPayload(
      event,
      count(at(payload, "number")) ?? count(at(payload, "pull_request", "number")),
      "number",
    ),
    baseBranch: firstOf(context.env, label, "GITHUB_BASE_REF"),
    warnings:
      sha === undefined
        ? [
            `The ${event} event payload is unreadable (GITHUB_EVENT_PATH), so the pull request head commit is unknown`,
          ]
        : undefined,
  };
}

/**
 * `merge_group`: the queue's head commit and the branch it merges into. GITHUB_SHA is documented
 * as the merge group's SHA, so it backs the payload field; GITHUB_REF_NAME is the queue's own ref,
 * never a branch.
 */
function githubMergeGroup(context: CiContext): CiFields {
  const payload = githubPayload(context);
  const headSha = fromPayload(
    "merge_group",
    text(at(payload, "merge_group", "head_sha")),
    "merge_group.head_sha",
  );
  const base = mapSourced(
    fromPayload(
      "merge_group",
      text(at(payload, "merge_group", "base_ref")),
      "merge_group.base_ref",
    ),
    stripHeads,
  );
  return {
    sha: headSha ?? firstOf(context.env, "GitHub merge_group", "GITHUB_SHA"),
    branch: base,
    baseBranch: base,
  };
}

/** Every other event (`push`, a tag, `workflow_dispatch`, `schedule`): the ref that ran. */
function githubRef({ env }: CiContext): CiFields {
  const event = valueOf(env, "GITHUB_EVENT_NAME") ?? "push";
  const label = env["GITHUB_REF_TYPE"] === "tag" ? `GitHub ${event} (tag)` : `GitHub ${event}`;
  return {
    sha: firstOf(env, label, "GITHUB_SHA"),
    branch: firstOf(env, label, "GITHUB_REF_NAME"),
  };
}

function resolveGithub(context: CiContext): CiFields {
  const event = valueOf(context.env, "GITHUB_EVENT_NAME") ?? "";
  if (event === "pull_request" || event === "pull_request_target") {
    return githubPullRequest(context, event);
  }
  return event === "merge_group" ? githubMergeGroup(context) : githubRef(context);
}

/** `Name <email>` (GitLab's CI_COMMIT_AUTHOR) split into its parts. */
function splitAuthor(author: Sourced | undefined): Pick<CiFields, "authorName" | "authorEmail"> {
  const match = /^(?<name>.*?)\s*<(?<email>[^>]*)>$/u.exec(author?.value ?? "");
  const name = match?.groups?.["name"];
  const email = match?.groups?.["email"];
  return {
    authorName: author && name ? { value: name, source: author.source } : undefined,
    authorEmail: author && email ? { value: email, source: author.source } : undefined,
  };
}

/**
 * Merge-request pipelines build the source branch; the head SHA is `CI_MERGE_REQUEST_SOURCE_BRANCH_SHA`
 * when set (merged-results pipelines), else `CI_COMMIT_SHA`. Branch pipelines and tags use the commit's ref.
 * https://docs.gitlab.com/ci/variables/predefined_variables/
 */
function resolveGitlab({ env }: CiContext): CiFields {
  const label = "GitLab CI";
  const message = firstOf(env, label, "CI_COMMIT_MESSAGE");
  const author = splitAuthor(firstOf(env, label, "CI_COMMIT_AUTHOR"));
  if (valueOf(env, "CI_MERGE_REQUEST_IID") === undefined) {
    return {
      sha: firstOf(env, label, "CI_COMMIT_SHA"),
      branch: firstOf(env, label, "CI_COMMIT_REF_NAME"),
      message,
      ...author,
    };
  }
  const mr = `${label} merge request`;
  return {
    sha: firstOf(env, mr, "CI_MERGE_REQUEST_SOURCE_BRANCH_SHA", "CI_COMMIT_SHA"),
    branch: firstOf(env, mr, "CI_MERGE_REQUEST_SOURCE_BRANCH_NAME"),
    pullRequest: firstOf(env, mr, "CI_MERGE_REQUEST_IID"),
    baseBranch: firstOf(env, mr, "CI_MERGE_REQUEST_TARGET_BRANCH_NAME"),
    message,
    ...author,
  };
}

/** https://vercel.com/docs/environment-variables/system-environment-variables */
function resolveVercel({ env }: CiContext): CiFields {
  const label = "Vercel";
  return {
    sha: firstOf(env, label, "VERCEL_GIT_COMMIT_SHA"),
    branch: firstOf(env, label, "VERCEL_GIT_COMMIT_REF"),
    message: firstOf(env, label, "VERCEL_GIT_COMMIT_MESSAGE"),
    authorName: firstOf(env, label, "VERCEL_GIT_COMMIT_AUTHOR_NAME"),
    pullRequest: firstOf(env, label, "VERCEL_GIT_PULL_REQUEST_ID"),
  };
}

/**
 * `HEAD` is the head branch Netlify received from the git provider, `COMMIT_REF` the commit.
 * https://docs.netlify.com/build/configure-builds/environment-variables/
 */
function resolveNetlify({ env }: CiContext): CiFields {
  const label = "Netlify";
  return {
    sha: firstOf(env, label, "COMMIT_REF"),
    branch: firstOf(env, label, "HEAD"),
    pullRequest: env["PULL_REQUEST"] === "true" ? firstOf(env, label, "REVIEW_ID") : undefined,
  };
}

/**
 * `CIRCLE_PR_NUMBER` exists only on forked pull requests; a tag build has `CIRCLE_TAG` and no branch.
 * https://circleci.com/docs/reference/variables/
 */
function resolveCircle({ env }: CiContext): CiFields {
  const label = "CircleCI";
  return {
    sha: firstOf(env, label, "CIRCLE_SHA1"),
    branch: firstOf(env, label, "CIRCLE_BRANCH", "CIRCLE_TAG"),
    pullRequest: firstOf(env, label, "CIRCLE_PR_NUMBER"),
  };
}

/**
 * `BUILDKITE_COMMIT` may be the symbolic `HEAD` before checkout, which names no commit.
 * https://buildkite.com/docs/pipelines/configure/environment-variables
 */
function resolveBuildkite({ env }: CiContext): CiFields {
  const label = "Buildkite";
  const sha = firstOf(env, label, "BUILDKITE_COMMIT");
  const pr = firstOf(env, label, "BUILDKITE_PULL_REQUEST");
  return {
    sha: sha?.value === "HEAD" ? undefined : sha,
    branch: firstOf(env, label, "BUILDKITE_BRANCH", "BUILDKITE_TAG"),
    message: firstOf(env, label, "BUILDKITE_MESSAGE"),
    authorName: firstOf(env, label, "BUILDKITE_BUILD_AUTHOR"),
    authorEmail: firstOf(env, label, "BUILDKITE_BUILD_AUTHOR_EMAIL"),
    pullRequest: pr?.value === "false" ? undefined : pr,
    baseBranch: firstOf(env, label, "BUILDKITE_PULL_REQUEST_BASE_BRANCH"),
  };
}

/**
 * Bitbucket sets `BITBUCKET_BRANCH` only on branch pipelines and `BITBUCKET_TAG` only on tags.
 * https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/
 */
function resolveBitbucket({ env }: CiContext): CiFields {
  const label = "Bitbucket Pipelines";
  return {
    sha: firstOf(env, label, "BITBUCKET_COMMIT"),
    branch: firstOf(env, label, "BITBUCKET_BRANCH", "BITBUCKET_TAG"),
    pullRequest: firstOf(env, label, "BITBUCKET_PR_ID"),
    baseBranch: firstOf(env, label, "BITBUCKET_PR_DESTINATION_BRANCH"),
  };
}

/** A branch ref of a pull request's merge (`refs/pull/<n>/merge`) names no branch. */
function azureBranch(env: CiEnv, label: string): Sourced | undefined {
  return mapSourced(firstOf(env, label, "BUILD_SOURCEBRANCH"), (ref) =>
    ref.startsWith("refs/pull/") ? undefined : ref.replace(/^refs\/(?:heads|tags)\//u, ""),
  );
}

/**
 * For a build a pull request's branch policy started, the source commit and branch are the
 * `SYSTEM_PULLREQUEST_*` variables (`BUILD_SOURCEVERSION` is then the merge commit). Otherwise the
 * build's own source version and ref, with a `refs/heads/` or `refs/tags/` prefix removed.
 * https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables
 */
function resolveAzure({ env }: CiContext): CiFields {
  const label = "Azure Pipelines";
  const prSha = firstOf(env, `${label} pull request`, "SYSTEM_PULLREQUEST_SOURCECOMMITID");
  if (prSha === undefined) {
    const sha = firstOf(env, label, "BUILD_SOURCEVERSION");
    const branch = azureBranch(env, label);
    return { sha: branch === undefined ? undefined : sha, branch };
  }
  const pr = `${label} pull request`;
  return {
    sha: prSha,
    branch: mapSourced(firstOf(env, pr, "SYSTEM_PULLREQUEST_SOURCEBRANCH"), stripHeads),
    pullRequest: firstOf(env, pr, "SYSTEM_PULLREQUEST_PULLREQUESTNUMBER"),
    baseBranch: mapSourced(firstOf(env, pr, "SYSTEM_PULLREQUEST_TARGETBRANCH"), stripHeads),
  };
}

/**
 * `GIT_COMMIT` and `GIT_LOCAL_BRANCH` come from the git plugin. In a multibranch pull request
 * `BRANCH_NAME` is `PR-<n>` and `CHANGE_ID` is set, so the branch is left to local git.
 * https://plugins.jenkins.io/git/ and https://www.jenkins.io/doc/book/pipeline/multibranch/
 */
function resolveJenkins({ env }: CiContext): CiFields {
  const label = "Jenkins";
  const pullRequest = firstOf(env, label, "CHANGE_ID");
  return {
    sha: firstOf(env, label, "GIT_COMMIT"),
    branch: pullRequest ? undefined : firstOf(env, label, "GIT_LOCAL_BRANCH", "BRANCH_NAME"),
    pullRequest,
  };
}

/**
 * The providers, in the order they are tried. GitHub comes first and the GitLab row before the
 * generic `CI_*` names it owns, so the order of the first three matches the lookup this table replaced.
 */
export const CI_PROVIDERS: readonly CiProvider[] = [
  // https://docs.github.com/en/actions/reference/workflows-and-actions/variables
  { name: "GitHub Actions", detect: ["GITHUB_ACTIONS", "GITHUB_SHA"], resolve: resolveGithub },
  // https://vercel.com/docs/environment-variables/system-environment-variables
  { name: "Vercel", detect: ["VERCEL", "VERCEL_GIT_COMMIT_SHA"], resolve: resolveVercel },
  // https://docs.gitlab.com/ci/variables/predefined_variables/
  { name: "GitLab CI", detect: ["GITLAB_CI", "CI_COMMIT_SHA"], resolve: resolveGitlab },
  // https://docs.netlify.com/build/configure-builds/environment-variables/
  { name: "Netlify", detect: ["NETLIFY"], resolve: resolveNetlify },
  // https://circleci.com/docs/reference/variables/
  { name: "CircleCI", detect: ["CIRCLECI"], resolve: resolveCircle },
  // https://buildkite.com/docs/pipelines/configure/environment-variables
  { name: "Buildkite", detect: ["BUILDKITE"], resolve: resolveBuildkite },
  // https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/
  { name: "Bitbucket Pipelines", detect: ["BITBUCKET_BUILD_NUMBER"], resolve: resolveBitbucket },
  // https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables
  { name: "Azure Pipelines", detect: ["TF_BUILD"], resolve: resolveAzure },
  // https://www.jenkins.io/doc/book/pipeline/jenkinsfile/ (JENKINS_URL)
  { name: "Jenkins", detect: ["JENKINS_URL"], resolve: resolveJenkins },
];

/** The default context: the process environment and real files. */
function defaultContext(): CiContext {
  return { env: process.env, readJson: readJsonFile };
}

/**
 * What the first detected CI provider says, or null outside CI. A detected provider that supplies
 * no field still wins, so a later provider's variables never leak into its identity.
 *
 * @param context - Environment and file reader (defaults to the process and real files).
 */
export function detectCi(context: CiContext = defaultContext()): CiIdentity | null {
  const provider = CI_PROVIDERS.find((row) =>
    row.detect.some((name) => valueOf(context.env, name)),
  );
  return provider === undefined ? null : { provider: provider.name, ...provider.resolve(context) };
}
