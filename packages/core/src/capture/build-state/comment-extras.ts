/** The facts the pull-request comment shows beyond the build row (ADR 0014): read at delivery, never from error text. */
import type { BuildStateExtras } from "../../adapters/notifier/build-state.ts";
import { latestVerdicts } from "../../models/build-review-status.ts";
import { BuildReviewModel } from "../../models/build-review.ts";
import { CaptureAttemptModel } from "../../models/capture-attempt.ts";
import { UserModel } from "../../models/user.ts";
import type { Build } from "../../schema/build.ts";
import type { Snapshot } from "../../schema/snapshot.ts";
import { isA11yNote } from "../a11y/index.ts";
import { parseList } from "../inherited-a11y.ts";
import { parseTestResults } from "../tests.ts";
import type { BuildStateDeps } from "./types.ts";

/** Phrases by error class: the comment is public, so no message, path or endpoint ever reaches it. */
const REASON_BY_CLASS: Readonly<Record<string, string>> = {
  TargetLaunchError: "a browser failed to start",
  RemoteConnectError: "a browser failed to start",
  JobAbortedError: "timed out",
  ZipLimitError: "the Storybook could not be published",
  ZipInvalidError: "the Storybook could not be published",
};

/** The error class an attempt stored: the name its stack starts with, never any text after it. */
const CLASS_OF_STACK = /^(?<name>[A-Za-z]+Error):/u;

/** A fixed phrase for the stored error's class, or undefined for any other error. */
export function failureReasonOf(stored: string | null | undefined): string | undefined {
  const name = CLASS_OF_STACK.exec(stored ?? "")?.groups?.["name"];
  return name === undefined ? undefined : REASON_BY_CLASS[name];
}

const OVERFLOW_LINE = /^…and (?<omitted>\d+) more$/u;

/** Accessibility findings behind the snapshots: notes are no finding, `…and N more` stands for N. */
export function a11yCountOf(snapshots: readonly Pick<Snapshot, "a11yViolations">[]): number {
  return snapshots
    .flatMap((snapshot) => parseList(snapshot.a11yViolations))
    .filter((text) => !isA11yNote(text))
    .reduce((sum, text) => sum + Number(OVERFLOW_LINE.exec(text)?.groups?.["omitted"] ?? 1), 0);
}

/** `Title / test name` of every failing Storybook test of the build. */
export function failedTestsOf(build: Pick<Build, "testResults">): string[] {
  return parseTestResults(build.testResults)
    .filter((result) => result.status === "failed")
    .map((result) => `${result.title} / ${result.name}`);
}

/** Display name of whoever gave the verdict that closed the build; never an email address. */
async function reviewerOf(deps: BuildStateDeps, build: Build): Promise<string | undefined> {
  const verdict = build.status === "approved" ? "approved" : "rejected";
  const reviews = latestVerdicts(await new BuildReviewModel(deps.db).listByBuild(build.id));
  const userId = reviews.findLast((review) => review.verdict === verdict)?.userId;
  const user = userId ? await new UserModel(deps.db).get(userId) : null;
  const shown = user?.displayNameOverride;
  return shown !== undefined && shown !== null && shown !== "" ? shown : user?.name;
}

async function failureOf(deps: BuildStateDeps, build: Build): Promise<string | undefined> {
  const attempts = await new CaptureAttemptModel(deps.db).listByBuild(build.id);
  return failureReasonOf(attempts.findLast((attempt) => attempt.status === "failed")?.error);
}

/** What the comment shows besides the build row; each is left out while it does not apply. */
export async function extrasOf(
  deps: BuildStateDeps,
  where: { build: Build; testing: boolean; snapshots: readonly Snapshot[] | undefined },
): Promise<BuildStateExtras> {
  const { build, testing, snapshots } = where;
  const closed = build.status === "approved" || build.status === "rejected";
  const a11y = testing && snapshots ? a11yCountOf(snapshots) : 0;
  return {
    reviewer: closed ? await reviewerOf(deps, build) : undefined,
    failure: build.status === "failed" ? await failureOf(deps, build) : undefined,
    failedTests: testing ? failedTestsOf(build) : undefined,
    a11yCount: a11y > 0 ? a11y : undefined,
  };
}
