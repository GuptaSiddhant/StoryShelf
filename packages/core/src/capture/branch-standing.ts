/**
 * Whether a build that names the project's default branch counts as a default-branch build (ADR
 * 0009, amendment 2026-11-13). The branch and commit are whatever the uploader says, so the claim is
 * checked with the project's git host before anything trusts it: auto-approval, baseline
 * promotion, orphan cleanup and a passing status all read only this answer.
 */
import { LOCAL_SHA_PREFIX } from "@storyshelf/affected";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { NotifierProvider, StateNotifierAdapter } from "../adapters/notifier/provider.ts";
import type { Logger } from "../logger.ts";
import type { BuildModel } from "../models/build.ts";
import type { BranchVerification, Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { SecretInput } from "../utils/encrypt.ts";
import { stateTargets } from "./build-state/deliver.ts";

/** What checking a claim needs: the project's git channels and the key that decrypts their secrets. */
export interface StandingDeps {
  db: DatabaseAdapter;
  /** Without providers or a secret no channel can check, so every claim is unverified. */
  notifiers?: readonly NotifierProvider[] | undefined;
  secret?: SecretInput | undefined;
  logger?: Logger | undefined;
}

/** A build's standing: whether it counts as default, and the host's answer that decided it. */
export interface DefaultBranchStanding {
  isDefault: boolean;
  /** Null when the build does not claim the default branch. */
  verification: BranchVerification | null;
}

/** A channel's adapter that can answer the question, with the channel id for the log. */
interface Verifier {
  channelId: string;
  check: NonNullable<StateNotifierAdapter["commitOnBranch"]>;
}

/**
 * The one decision on a build's default-branch claim. Not claimed: not default. Claimed: every
 * enabled git channel whose provider can check is asked; one confirmation makes it `verified`. A
 * host that says no makes it `refused`, and a host that cannot answer makes it `unreachable`: both
 * fail closed. With no channel that can check, the claim is `unverified`, and it counts only when
 * the project turned `requireVerifiedDefault` off.
 */
export async function defaultBranchStanding(
  deps: StandingDeps,
  loaded: {
    build: Pick<Build, "id" | "gitSha" | "gitBranch">;
    project: Pick<Project, "id" | "gitDefaultBranch" | "requireVerifiedDefault">;
  },
): Promise<DefaultBranchStanding> {
  const { build, project } = loaded;
  if (build.gitBranch !== project.gitDefaultBranch) {
    return { isDefault: false, verification: null };
  }
  const verifiers = hasCommit(build) ? await verifiersOf(deps, project.id) : [];
  if (verifiers.length === 0) {
    return { isDefault: project.requireVerifiedDefault === false, verification: "unverified" };
  }
  const verification = await askHosts(deps, verifiers, {
    buildId: build.id,
    sha: build.gitSha,
    branch: project.gitDefaultBranch,
  });
  return { isDefault: verification === "verified", verification };
}

/** A real commit a host can look up (not empty, not a local identity). */
function hasCommit(build: Pick<Build, "gitSha">): boolean {
  return build.gitSha.length > 0 && !build.gitSha.startsWith(LOCAL_SHA_PREFIX);
}

async function verifiersOf(deps: StandingDeps, projectId: string): Promise<Verifier[]> {
  const { notifiers, secret } = deps;
  if (notifiers === undefined || secret === undefined) {
    return [];
  }
  const targets = await stateTargets({ ...deps, notifiers, secret }, projectId);
  return targets.flatMap(({ channel, provider }) => {
    const adapter = provider.create({
      config: channel.config,
      secret: channel.secret,
      logger: deps.logger,
    });
    const check = adapter.commitOnBranch?.bind(adapter);
    return check === undefined ? [] : [{ channelId: channel.id, check }];
  });
}

/** Ask every verifier; one yes verifies, else one no refuses, else the hosts were unreachable. */
async function askHosts(
  deps: StandingDeps,
  verifiers: readonly Verifier[],
  claim: { buildId: string; sha: string; branch: string },
): Promise<BranchVerification> {
  const answers = await Promise.allSettled(
    verifiers.map(
      async (verifier) => await verifier.check({ sha: claim.sha, branch: claim.branch }),
    ),
  );
  for (const [index, answer] of answers.entries()) {
    if (answer.status === "rejected") {
      deps.logger?.warn(
        { err: answer.reason, buildId: claim.buildId, channelId: verifiers[index]?.channelId },
        "git host could not confirm the default-branch claim",
      );
    }
  }
  if (answers.some((answer) => answer.status === "fulfilled" && answer.value)) {
    return "verified";
  }
  return answers.some((answer) => answer.status === "fulfilled") ? "refused" : "unreachable";
}

/**
 * Decide the build's standing and write it to the row (`BuildModel.setBranchStanding`), so the
 * pipeline, the shards and the review routes read the decision, never the uploader's claim. Returns
 * the build as written. A claim that does not count is logged with its reason.
 */
export async function settleBranchStanding(
  deps: StandingDeps & { builds: Pick<BuildModel, "setBranchStanding"> },
  loaded: { build: Build; project: Project },
): Promise<Build> {
  const standing = await defaultBranchStanding(deps, loaded);
  const { build } = loaded;
  if (
    standing.verification === null &&
    !build.isDefault &&
    (build.branchVerified ?? null) === null
  ) {
    return build;
  }
  if (standing.verification !== null && !standing.isDefault) {
    deps.logger?.info(
      { buildId: build.id, branch: build.gitBranch, verification: standing.verification },
      "default-branch claim not confirmed; the build is reviewed like a feature branch",
    );
  }
  return await deps.builds.setBranchStanding(build.id, standing);
}
