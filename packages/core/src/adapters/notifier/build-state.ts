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
import type { NotifierState, StateAnnotation } from "./types.ts";

/** Most per-snapshot annotations a build state carries; the rest are counted (`omitted`). */
export const MAX_ANNOTATIONS = 200;

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
  /** Build status: `pending`, `capturing`, `comparing`, `reviewing`, `approved`, `rejected`, `failed`, `cancelled`. */
  status: string;
  snapshotCount: number;
  changedCount: number;
  approvedCount: number;
  rejectedCount: number;
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
  urls: Pick<UrlBuilder, "build" | "storybookBuild" | "snapshot">;
  flags: BuildStateFlags;
  publishing: PublishingState;
  /**
   * Approval progress of the build-level review: the approvals among each reviewer's latest
   * verdict and the approvals the project requires. Shown on `<prefix>/review` while it waits.
   */
  approvals?: { given: number; required: number } | undefined;
  /** The build's snapshots; the `changed` and `new` ones become annotations of `<prefix>/testing`. */
  changes?: readonly BuildStateChange[] | undefined;
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
    ...withAnnotations(gateStatus(input, links.build), input),
    storybookStatus(input.publishing, input.prefix, links),
  ].map((status) => withProgress(status, input.build));
  return { statuses, comment: commentOf(input, statuses, links) };
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

/** The links to show. */
function linksOf(input: BuildStateInput): Links {
  const { urls, projectSlug, build } = input;
  return {
    build: urls.build(projectSlug, build.id),
    storybook: `${urls.storybookBuild(projectSlug, build.id).replace(/\/+$/u, "")}/`,
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
    case "cancelled": {
      return CANCELLED;
    }
    default: {
      return { state: "pending", description: "Capturing and comparing screenshots" };
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
