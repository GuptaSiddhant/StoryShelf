/**
 * The states a build's git channels show, as one pure function of the build (ADR 0014, decision 5).
 * It reads no clock, database or provider: callers hand it the build, the channel's prefix and the
 * flags, and write the result to the host. Every transition and the end of publishing call it
 * again, so a build that was never captured still gets its statuses and a repeated call changes
 * nothing.
 */
import { LOCAL_SHA_PREFIX } from "@storyshelf/affected";
import type { UrlBuilder } from "../../urls.ts";
import { buildCommentMarkdown } from "./build-comment.ts";
import type { NotifierState } from "./types.ts";

/** Names of the statuses below a channel's prefix. */
export type StatusName = "testing" | "review" | "storybook";

/** How publishing the build's Storybook stands. */
export type PublishingState = "pending" | "success" | "failure";

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
  /** Build status: `pending`, `capturing`, `comparing`, `reviewing`, `approved`, `rejected`, `failed`. */
  status: string;
  snapshotCount: number;
  changedCount: number;
  approvedCount: number;
  rejectedCount: number;
}

/** Inputs of {@link statusesForBuild}. */
export interface BuildStateInput {
  build: BuildStateBuild;
  projectSlug: string;
  /** The channel's status-name prefix, without a trailing slash. */
  prefix: string;
  /**
   * Absolute links (`createUrlBuilder(publicOrigin)`). `null` when no public origin is known: the
   * statuses then carry no link and there is no pull-request comment, whose job is to link (ADR 0007).
   */
  urls: Pick<UrlBuilder, "build" | "storybookBuild"> | null;
  flags: BuildStateFlags;
  publishing: PublishingState;
}

/** One commit status to show. */
export interface DesiredStatus {
  name: StatusName;
  /** Full name on the host, `<prefix>/<name>`. */
  context: string;
  state: NotifierState;
  description: string;
  /** What the status links to: the build page, or the published Storybook for `storybook`; absent without a public origin. */
  url?: string | undefined;
}

/** The pull-request comment to show. */
export interface DesiredComment {
  /** The build page; it keys the comment, one per build. */
  url: string;
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
  const statuses = [
    ...gateStatus(input, links?.build),
    storybookStatus(input.publishing, input.prefix, links),
  ];
  return { statuses, comment: links === null ? null : commentOf(input, statuses, links) };
}

function commentOf(
  input: BuildStateInput,
  statuses: DesiredStatus[],
  links: Links,
): DesiredComment {
  const gates = statuses.filter((status) => status.name !== "storybook");
  return {
    url: links.build,
    state: gates[0]?.state ?? "success",
    markdown: buildCommentMarkdown({
      buildUrl: links.build,
      storybookUrl: input.publishing === "success" ? links.storybook : undefined,
      gates,
      counts: input.flags.testing || input.flags.review ? input.build : undefined,
    }),
  };
}

interface Links {
  build: string;
  storybook: string;
}

/** The links to show, or `null` without a public origin. */
function linksOf(input: BuildStateInput): Links | null {
  const { urls, projectSlug, build } = input;
  if (urls === null) {
    return null;
  }
  return {
    build: urls.build(projectSlug, build.id),
    storybook: `${urls.storybookBuild(projectSlug, build.id).replace(/\/+$/u, "")}/`,
  };
}

/** `testing` when it is on; `review` when only review is on; none for a hosting-only build. */
function gateStatus(input: BuildStateInput, url: string | undefined): DesiredStatus[] {
  const { flags, build, prefix } = input;
  if (flags.testing) {
    return [{ name: "testing", context: `${prefix}/testing`, url, ...testingOutcome(build) }];
  }
  if (flags.review) {
    return [{ name: "review", context: `${prefix}/review`, url, ...reviewOutcome(build) }];
  }
  return [];
}

type Outcome = Pick<DesiredStatus, "state" | "description">;

/** `pending` until captured, `pending` while review is open, then the review's result. */
function testingOutcome(build: BuildStateBuild): Outcome {
  switch (build.status) {
    case "reviewing": {
      return {
        state: "pending",
        description: `Review open: ${plural(openCount(build), "change")} to review`,
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
    default: {
      return { state: "pending", description: "Capturing and comparing screenshots" };
    }
  }
}

/** The build-level verdict: `pending` until given, then `success` or `failure`. */
function reviewOutcome(build: BuildStateBuild): Outcome {
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
    default: {
      return { state: "pending", description: "Waiting for a review verdict" };
    }
  }
}

/** Informational: never a gate, linking to the published Storybook once there is one. */
function storybookStatus(
  publishing: PublishingState,
  prefix: string,
  links: Links | null,
): DesiredStatus {
  const base = { name: "storybook", context: `${prefix}/storybook` } as const;
  if (publishing === "success") {
    return {
      ...base,
      state: "success",
      description: "Storybook published",
      url: links?.storybook,
    };
  }
  if (publishing === "failure") {
    return {
      ...base,
      state: "failure",
      description: "Storybook could not be published",
      url: links?.build,
    };
  }
  return { ...base, state: "pending", description: "Publishing Storybook", url: links?.build };
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
