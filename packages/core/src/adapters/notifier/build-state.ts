/**
 * The states a build's git channels show, as one pure function of the build (ADR 0014, decision 5).
 * It reads no clock, database or provider: callers hand it the build, the channel's prefix and the
 * flags, and write the result to the host. Every transition and the end of publishing call it
 * again, so a build that was never captured still gets its statuses and a repeated call changes
 * nothing.
 */
import { LOCAL_SHA_PREFIX } from "@storyshelf/affected";
import type { UrlBuilder } from "../../urls.ts";
import { percentOf } from "./build-comment-text.ts";
import { buildCommentMarkdown, skippedCommentMarkdown } from "./build-comment.ts";
import type { CommentChange } from "./build-comment.ts";
import type { NotifierState, StateAnnotation } from "./types.ts";

/** Most per-snapshot annotations a build state carries; the rest are counted (`omitted`). */
export const MAX_ANNOTATIONS = 200;

/** Names of the statuses below a channel's prefix. */
export type StatusName = "testing" | "review" | "storybook";

/**
 * How publishing the build's Storybook stands. `unavailable` is a build that was accepted or
 * reviewed without a Storybook to show (purged or lost content): not a wait, so no permanent
 * `pending` check, and the operator is pointed at the build page.
 */
export type PublishingState = "pending" | "success" | "failure" | "unavailable";

/** What decides which statuses exist (ADR 0014, decision 5). */
export interface BuildStateFlags {
  /** `testing` is on: `<prefix>/testing` is the merge gate. */
  testing: boolean;
  /** Review is on for the project: with `testing` off, `<prefix>/review` is the gate. */
  review: boolean;
}

/** The part of a build row the function reads. */
export interface BuildStateBuild {
  id: string;
  gitSha: string;
  /** Build status: `pending`, `capturing`, `comparing`, `reviewing`, `approved`, `rejected`, `failed`, `cancelled`, `skipped`. */
  status: string;
  snapshotCount: number;
  changedCount: number;
  approvedCount: number;
  rejectedCount: number;
  /** The branch the uploader named; with {@link BuildStateBuild.branchVerified} it explains a refused claim. */
  gitBranch?: string | undefined;
  /** Whether the build counts as a default-branch build (`defaultBranchStanding`). */
  isDefault?: boolean | undefined;
  /** The git host's answer to a default-branch claim; null or absent when nothing was claimed. */
  branchVerified?: string | null | undefined;
  /** Snapshots inherited from the baseline without rendering; with `snapshotCount` it tells a partial capture. */
  inheritedCount?: number | undefined;
  /** When the build row last changed (the footer's time; the function reads no clock). */
  updatedAt?: string | undefined;
}

/**
 * The build a `skipped` build repeats (ADR 0044): its current outcome is the skipped build's. Callers
 * resolve it with `BuildModel.skipSourceOf`; leave it out when the source row is gone.
 */
export interface BuildStateSource {
  id: string;
  gitSha: string;
  /** The source's build status now, not when the skipped build was created. */
  status: string;
  /** The source's Storybook is published and its content present. */
  available: boolean;
}

/** The part of a snapshot row the annotations read. */
export interface BuildStateChange {
  id: string;
  /** `changed` or `new`; anything else is not a change to review. */
  status: string;
  storyTitle: string;
  storyName: string;
  storyImportPath: string | null;
  viewportName: string;
  browser?: string | undefined;
  /** The Storybook entry id, for the link to the story in the published Storybook. */
  storyId?: string | undefined;
  /** Share of pixels that differ (0 to 1), shown as a percent. */
  diffRatio?: number | null | undefined;
}

/** Inputs of {@link statusesForBuild}. */
export interface BuildStateInput {
  build: BuildStateBuild;
  projectSlug: string;
  /** The channel's status-name prefix, without a trailing slash. */
  prefix: string;
  /**
   * Absolute links (`createUrlBuilder(publicOrigin)`). A build's state is only ever shown once a
   * public origin is resolved (ADR 0014, decision 11), so every status links and the comment exists.
   */
  urls: Pick<
    UrlBuilder,
    | "build"
    | "buildDiff"
    | "buildLog"
    | "buildRetry"
    | "storybookBuild"
    | "storybookIndex"
    | "storybookStory"
    | "snapshot"
  >;
  flags: BuildStateFlags;
  publishing: PublishingState;
  /**
   * Approval progress of the build-level review: the approvals among each reviewer's latest
   * verdict and the approvals the project requires. Shown on `<prefix>/review` while it waits.
   */
  approvals?: { given: number; required: number } | undefined;
  /** For a `skipped` build, the build it repeats; absent when that build no longer exists. */
  source?: BuildStateSource | undefined;
  /** The build's snapshots; the `changed` and `new` ones become annotations of `<prefix>/testing`. */
  changes?: readonly BuildStateChange[] | undefined;
  /**
   * The newer build that cancelled this one (ADR 0045). A cancelled build with it keeps the
   * `cancelled` outcome, described `Superseded by <short sha>`, and the comment links that build.
   */
  supersededBy?: { id: string; sha: string } | undefined;
  /** Extra facts for the comment; each is omitted from it while absent. */
  extras?: BuildStateExtras | undefined;
}

/** What the comment shows beyond the build row and its snapshots; the caller reads them. */
export interface BuildStateExtras {
  /** Who gave the verdict of an approved or rejected build. */
  reviewer?: string | undefined;
  /** Short reason of a failed capture. */
  failure?: string | undefined;
  /** Names of failing Storybook tests. */
  failedTests?: readonly string[] | undefined;
  /** Titles of stories the baseline had and this build lacks. */
  removed?: readonly string[] | undefined;
  /** Snapshots with accessibility findings (`a11yCount` of the comment). */
  a11yCount?: number | undefined;
  /** Earlier builds of the pull request, newest first. */
  earlier?: readonly { state: string; sha: string; url: string }[] | undefined;
}

/** One commit status to show. */
export interface DesiredStatus {
  name: StatusName;
  /** Full name on the host, `<prefix>/<name>`. */
  context: string;
  state: NotifierState;
  description: string;
  /** What the status links to: the build page, or the published Storybook for `storybook`. */
  url: string;
  /** True for the Storybook status, which is never a gate. */
  informational?: boolean;
  /** Set on a `pending` status: `queued` before capture starts, else `running`. */
  progress?: "queued" | "running";
  /** Per-snapshot findings (only `testing`), at most {@link MAX_ANNOTATIONS}. */
  annotations?: StateAnnotation[];
  /** Changes beyond the cap. */
  omitted?: number;
  /** On a gate: the comment's Markdown, which the GitHub check run shows as its summary. */
  summary?: string;
}

/** The pull-request comment to show. */
export interface DesiredComment {
  /** The build page the comment links. */
  url: string;
  /** Keys the comment: one per pull request and project. */
  projectSlug: string;
  /** The build shown; creation order (ULID) decides which build's write stands. */
  buildId: string;
  markdown: string;
  state: NotifierState;
}

/** Everything a channel should show for a build. */
export interface BuildStateSet {
  statuses: DesiredStatus[];
  comment: DesiredComment | null;
}

/** Statuses and comment for a build; empty without a real commit (no SHA or a local identity). */
export function statusesForBuild(input: BuildStateInput): BuildStateSet {
  const { build } = input;
  if (build.gitSha.length === 0 || build.gitSha.startsWith(LOCAL_SHA_PREFIX)) {
    return { statuses: [], comment: null };
  }
  const links = linksOf(input);
  if (build.status === "skipped") {
    return skippedState(input, links);
  }
  const statuses = [
    ...withAnnotations(withSuperseded(gateStatus(input, links.build), input), input),
    storybookStatus(input.publishing, input.prefix, links),
  ].map((status) => withProgress(status, input.build));
  return withSummary(statuses, commentOf(input, statuses, links));
}

/** The gates carry the comment as their check-run summary; the informational Storybook status does not. */
function withSummary(statuses: DesiredStatus[], comment: DesiredComment): BuildStateSet {
  for (const status of statuses) {
    if (status.name !== "storybook") {
      status.summary = comment.markdown;
    }
  }
  return { statuses, comment };
}

/** A superseded build (cancelled by a newer one) says which commit replaced it; the outcome stays `cancelled`. */
function withSuperseded(gates: DesiredStatus[], input: BuildStateInput): DesiredStatus[] {
  const { supersededBy, build } = input;
  if (supersededBy === undefined || build.status !== "cancelled") {
    return gates;
  }
  const description = `Superseded by ${shortSha(supersededBy.sha)}`;
  return gates.map((gate) => ({ ...gate, description }));
}

/**
 * A skipped build shows the **current** outcome of its source (ADR 0044, decision 5): the gate
 * follows the source's verdict, the `storybook` status links the source's Storybook only while it
 * is available, and the comment is one line naming both builds.
 */
function skippedState(input: BuildStateInput, links: Links): BuildStateSet {
  const { source, flags, prefix } = input;
  const gate = skippedGate(input);
  const sourceUrl = source === undefined ? undefined : sourceLinks(input, source);
  const storybook: DesiredStatus[] =
    source?.available === true && sourceUrl !== undefined
      ? [
          {
            name: "storybook",
            context: `${prefix}/storybook`,
            informational: true,
            state: "success",
            description: "Storybook published",
            url: sourceUrl.storybook,
          },
        ]
      : [];
  const statuses = [...(flags.testing || flags.review ? [gate] : []), ...storybook].map((status) =>
    withProgress(status, input.build),
  );
  const markdown = skippedComment(input, links, sourceUrl?.build);
  return {
    statuses,
    comment: {
      url: links.build,
      projectSlug: input.projectSlug,
      buildId: input.build.id,
      state: gate.state,
      markdown,
    },
  };
}

/** The gate of a skipped build, under the same name `gateStatus` gives a normal one. */
function skippedGate(input: BuildStateInput): DesiredStatus {
  const { flags, prefix, source } = input;
  const name = flags.testing ? "testing" : "review";
  return {
    name,
    context: `${prefix}/${name}`,
    url: linksOf(input).build,
    ...skippedOutcome(source, flags.testing),
  };
}

/** What the source's status means for the skipped build (`approved` is the only green). */
function skippedOutcome(source: BuildStateSource | undefined, testing: boolean): Outcome {
  if (source === undefined) {
    return { state: "failure", description: "Compared build no longer exists" };
  }
  const since = `since ${shortSha(source.gitSha)}`;
  switch (source.status) {
    case "approved": {
      return { state: "success", description: `No story changed ${since}` };
    }
    case "rejected": {
      return { state: "failure", description: `No story changed ${since}, which was rejected` };
    }
    case "failed": {
      return { state: "failure", description: `No story changed ${since}, which failed` };
    }
    case "cancelled": {
      return CANCELLED;
    }
    default: {
      return {
        state: "pending",
        description: `No story changed ${since}, waiting for ${testing ? "its review" : "a review verdict"}`,
      };
    }
  }
}

/** The source build's page and Storybook links. */
function sourceLinks(input: BuildStateInput, source: BuildStateSource): Links {
  const { urls, projectSlug } = input;
  return {
    build: urls.build(projectSlug, source.id),
    storybook: urls.storybookIndex(projectSlug, source.id),
  };
}

/** One line linking both builds. */
function skippedComment(input: BuildStateInput, links: Links, sourceBuildUrl?: string): string {
  const { source } = input;
  return skippedCommentMarkdown({
    buildUrl: links.build,
    source:
      source === undefined || sourceBuildUrl === undefined
        ? undefined
        : { sha: shortSha(source.gitSha), url: sourceBuildUrl },
  });
}

/** The first seven characters of a commit. */
function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** `pending` is `queued` while the build waits to be captured, `running` after. */
function withProgress(status: DesiredStatus, build: BuildStateBuild): DesiredStatus {
  if (status.state !== "pending") {
    return status;
  }
  const queued = status.name !== "storybook" && build.status === "pending";
  return { ...status, progress: queued ? "queued" : "running" };
}

/** One annotation per changed snapshot, on the `testing` gate. */
function withAnnotations(gates: DesiredStatus[], input: BuildStateInput): DesiredStatus[] {
  const changed = (input.changes ?? []).filter((c) => c.status === "changed" || c.status === "new");
  if (changed.length === 0) {
    return gates;
  }
  const annotations = changed
    .slice(0, MAX_ANNOTATIONS)
    .map((change) => annotationOf(change, input));
  const omitted = changed.length - annotations.length;
  return gates.map((gate) =>
    gate.name === "testing" ? { ...gate, annotations, ...(omitted > 0 ? { omitted } : {}) } : gate,
  );
}

function annotationOf(change: BuildStateChange, input: BuildStateInput): StateAnnotation {
  const where = [change.viewportName, change.browser].filter(Boolean).join(", ");
  const isNew = change.status === "new";
  const name = `${change.storyTitle} / ${change.storyName}`;
  return {
    path: change.storyImportPath?.replace(/^(?:\.\/)+/u, "") ?? ".storybook",
    title: where === "" ? name : `${name} (${where})`,
    message: `${isNew ? "New snapshot" : "Visual change"}: review it at ${input.urls.snapshot(input.projectSlug, input.build.id, change.id)}`,
    url: input.urls.snapshot(input.projectSlug, input.build.id, change.id),
    level: isNew ? "notice" : "warning",
  };
}

function commentOf(
  input: BuildStateInput,
  statuses: DesiredStatus[],
  links: Links,
): DesiredComment {
  const gate = statuses.find((status) => status.name !== "storybook");
  const { build, flags, urls, projectSlug } = input;
  const extras = input.extras ?? {};
  const testing = flags.testing;
  return {
    url: links.build,
    projectSlug,
    buildId: build.id,
    state: gate?.state ?? "success",
    markdown: buildCommentMarkdown({
      testing,
      status: build.status,
      sha: shortSha(build.gitSha),
      reviewUrl: testing ? urls.buildDiff(projectSlug, build.id) : links.build,
      buildUrl: links.build,
      storybookUrl: input.publishing === "success" ? links.storybook : undefined,
      logUrl: urls.buildLog(projectSlug, build.id),
      retryUrl: urls.buildRetry(projectSlug, build.id),
      counts: build,
      changes: testing ? commentChanges(input) : undefined,
      approvals: input.approvals,
      capture: captureOf(build),
      updatedAt: build.updatedAt,
      supersededBy: supersededLink(input),
      ...extras,
    }),
  };
}

/** Stories rendered of the total, only for a build that inherited part of its snapshots. */
function captureOf(build: BuildStateBuild): { rendered: number; total: number } | undefined {
  const inherited = build.inheritedCount ?? 0;
  return inherited > 0
    ? { rendered: Math.max(0, build.snapshotCount - inherited), total: build.snapshotCount }
    : undefined;
}

/** One table row per changed or new snapshot, with its review page and its story's link. */
function commentChanges(input: BuildStateInput): CommentChange[] {
  const { urls, projectSlug, build, publishing } = input;
  return (input.changes ?? [])
    .filter((change) => change.status === "changed" || change.status === "new")
    .map((change) => ({
      story: `${change.storyTitle} / ${change.storyName}`,
      target: [change.browser, change.viewportName].filter(Boolean).join(", "),
      change: change.status === "new" ? "new" : (percentOf(change.diffRatio) ?? "changed"),
      reviewUrl: urls.snapshot(projectSlug, build.id, change.id),
      storyUrl:
        publishing === "success" && change.storyId
          ? urls.storybookStory(projectSlug, build.id, change.storyId, "story")
          : undefined,
    }));
}

/** The newer build's link and short commit, when this cancelled build was superseded by it. */
function supersededLink(input: BuildStateInput): { url: string; sha: string } | undefined {
  const { supersededBy, build } = input;
  if (supersededBy === undefined || build.status !== "cancelled") {
    return undefined;
  }
  return {
    url: input.urls.build(input.projectSlug, supersededBy.id),
    sha: shortSha(supersededBy.sha),
  };
}

interface Links {
  build: string;
  storybook: string;
}

/** The links to show. */
function linksOf(input: BuildStateInput): Links {
  const { urls, projectSlug, build } = input;
  return {
    build: urls.build(projectSlug, build.id),
    storybook: urls.storybookIndex(projectSlug, build.id),
  };
}

/** `testing` when it is on; `review` when only review is on; none for a hosting-only build. */
function gateStatus(input: BuildStateInput, url: string): DesiredStatus[] {
  const { flags, build, prefix } = input;
  if (flags.testing) {
    return [{ name: "testing", context: `${prefix}/testing`, url, ...testingOutcome(build) }];
  }
  if (flags.review) {
    return [
      {
        name: "review",
        context: `${prefix}/review`,
        url,
        ...reviewOutcome(build, input.approvals),
      },
    ];
  }
  return reviewClosed(input, url);
}

/**
 * Review is off and the build is accepted: a final `success`, so a `<prefix>/review` status left
 * `pending` by the time review was on (the switch-off pass accepts such builds) does not stay on
 * the pull request. The function sees no history, so every accepted build of a project with review
 * off shows it, and a host that requires the status never waits for one that will not come.
 */
function reviewClosed(input: BuildStateInput, url: string): DesiredStatus[] {
  if (input.build.status !== "approved") {
    return [];
  }
  const { prefix } = input;
  return [
    {
      name: "review",
      context: `${prefix}/review`,
      url,
      state: "success",
      description: "Review is off",
    },
  ];
}

type Outcome = Pick<DesiredStatus, "state" | "description">;

/**
 * A user cancelled the build (ADR 0006). It closes both gates the same way: the host shows
 * `cancelled` where it has the state (GitLab `canceled`, GitHub `error`), so a required status does
 * not wait for a result that will never come, and nothing says the build failed or was reviewed.
 */
const CANCELLED: Outcome = { state: "cancelled", description: "Cancelled" };

/** `pending` until captured, `pending` while review is open, then the review's result. */
function testingOutcome(build: BuildStateBuild): Outcome {
  switch (build.status) {
    case "reviewing": {
      const why = unconfirmedClaim(build);
      return {
        state: "pending",
        description: `${why ?? "Review open"}: ${plural(openCount(build), "change")} to review`,
      };
    }
    case "approved": {
      return { state: "success", description: approvedText(build) };
    }
    case "rejected": {
      return {
        state: "failure",
        description: `Review closed: ${plural(build.rejectedCount, "change")} rejected`,
      };
    }
    case "failed": {
      return { state: "failure", description: "Capture failed" };
    }
    case "cancelled": {
      return CANCELLED;
    }
    default: {
      return { state: "pending", description: "Capturing and comparing screenshots" };
    }
  }
}

/**
 * Why a build that names the default branch is reviewed like a feature branch (ADR 0009, amendment
 * 2026-11-13): the git host said the commit is not on it, could not answer, or no channel could
 * check. Null when the build claims nothing or the claim counts.
 */
function unconfirmedClaim(build: BuildStateBuild): string | null {
  if (build.isDefault !== false || (build.branchVerified ?? null) === null) {
    return null;
  }
  const branch = build.gitBranch ?? "the default branch";
  switch (build.branchVerified) {
    case "refused": {
      return `Commit is not on ${branch}`;
    }
    case "unreachable": {
      return `Git host could not confirm ${branch}`;
    }
    case "unverified": {
      return "Default branch not verified";
    }
    default: {
      return null;
    }
  }
}

/** The build-level verdict: `pending` until given, then `success` or `failure`. */
function reviewOutcome(build: BuildStateBuild, approvals: BuildStateInput["approvals"]): Outcome {
  switch (build.status) {
    case "approved": {
      return { state: "success", description: "Build approved" };
    }
    case "rejected": {
      return { state: "failure", description: "Build rejected" };
    }
    case "failed": {
      return { state: "failure", description: "Build failed" };
    }
    case "cancelled": {
      return CANCELLED;
    }
    default: {
      return { state: "pending", description: waitingText(approvals) };
    }
  }
}

/** What the `storybook` status and the build page say when the published content is missing. */
export const STORYBOOK_UNAVAILABLE = "Storybook content unavailable, see build page";

/** Informational: never a gate, linking to the published Storybook once there is one. */
function storybookStatus(publishing: PublishingState, prefix: string, links: Links): DesiredStatus {
  const base = { name: "storybook", context: `${prefix}/storybook`, informational: true } as const;
  if (publishing === "success") {
    return {
      ...base,
      state: "success",
      description: "Storybook published",
      url: links.storybook,
    };
  }
  if (publishing === "failure") {
    return {
      ...base,
      state: "failure",
      description: "Storybook could not be published",
      url: links.build,
    };
  }
  if (publishing === "unavailable") {
    return { ...base, state: "failure", description: STORYBOOK_UNAVAILABLE, url: links.build };
  }
  return { ...base, state: "pending", description: "Publishing Storybook", url: links.build };
}

/** `1 of 2 approvals` when the project needs several; a single approval just waits for a verdict. */
function waitingText(approvals: BuildStateInput["approvals"]): string {
  if (approvals === undefined || approvals.required <= 1) {
    return "Waiting for a review verdict";
  }
  return `Waiting for approvals: ${String(approvals.given)} of ${String(approvals.required)}`;
}

function openCount(build: BuildStateBuild): number {
  return Math.max(0, build.changedCount - build.approvedCount - build.rejectedCount);
}

function approvedText(build: BuildStateBuild): string {
  return build.changedCount === 0
    ? "Review closed: no visual changes"
    : `Review closed: ${plural(build.approvedCount, "change")} approved`;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}
