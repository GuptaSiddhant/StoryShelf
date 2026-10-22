/** Pure mapping from a desired status to GitHub check-run payloads (never posts anything). */
import type { NotifierState, StateAnnotation } from "@storyshelf/core/adapter/notifier";

/** GitHub accepts at most this many annotations per request. */
export const ANNOTATIONS_PER_REQUEST = 50;

/** What one check run shows. */
export interface CheckRunInput {
  /** Full status name: the check run's name, so a required check keeps its `<prefix>/testing` name. */
  context: string;
  state: NotifierState;
  description: string;
  /** Absolute link to the build page. */
  url?: string | undefined;
  progress?: "queued" | "running" | undefined;
  informational?: boolean | undefined;
  annotations?: readonly StateAnnotation[] | undefined;
  omitted?: number | undefined;
}

/** The lifecycle fields of a check run. */
export interface CheckRunPhase {
  status: "queued" | "in_progress" | "completed";
  conclusion?: "success" | "failure" | "cancelled" | "neutral";
}

/** One annotation as the Checks API takes it. */
export interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "notice" | "warning" | "failure";
  title: string;
  message: string;
  raw_details: string;
}

/** The body of a create or update of a check run, without the annotations. */
export interface CheckRunBody extends CheckRunPhase {
  name: string;
  external_id: string;
  details_url?: string;
  output: { title: string; summary: string };
}

/** The `external_id` that keys a check run: the same name always finds the same run. */
export function externalIdOf(context: string): string {
  return `storyshelf:${context}`;
}

/** `pending` is queued or in progress; a final state completes the run; a cancel is `cancelled`. */
export function phaseOf(
  input: Pick<CheckRunInput, "state" | "progress" | "informational">,
): CheckRunPhase {
  switch (input.state) {
    case "pending": {
      return { status: input.progress === "queued" ? "queued" : "in_progress" };
    }
    case "success": {
      return { status: "completed", conclusion: "success" };
    }
    case "cancelled": {
      return { status: "completed", conclusion: "cancelled" };
    }
    default: {
      return {
        status: "completed",
        conclusion: input.informational === true ? "neutral" : "failure",
      };
    }
  }
}

/** The check run to show for a desired status. */
export function checkRunBody(input: CheckRunInput): CheckRunBody {
  return {
    name: input.context,
    external_id: externalIdOf(input.context),
    ...phaseOf(input),
    ...(input.url === undefined ? {} : { details_url: input.url }),
    output: { title: input.description, summary: summaryOf(input) },
  };
}

/** The summary: the description, then the link to the build, then what the annotations leave out. */
export function summaryOf(input: CheckRunInput): string {
  const lines = [input.description];
  const omitted = input.omitted ?? 0;
  if (omitted > 0 && input.url !== undefined) {
    lines.push(`and ${String(omitted)} more changed snapshots: [open the build](${input.url})`);
  } else if (omitted > 0) {
    lines.push(`and ${String(omitted)} more changed snapshots`);
  } else if (input.url !== undefined) {
    lines.push(`[Open the build](${input.url})`);
  }
  return lines.join("\n\n");
}

/** Annotations as batches of at most {@link ANNOTATIONS_PER_REQUEST}, after the `skip` already on the run. */
export function annotationBatches(
  annotations: readonly StateAnnotation[],
  skip = 0,
): CheckAnnotation[][] {
  const pending = annotations.slice(skip).map((annotation) => annotationOf(annotation));
  const batches: CheckAnnotation[][] = [];
  for (let at = 0; at < pending.length; at += ANNOTATIONS_PER_REQUEST) {
    batches.push(pending.slice(at, at + ANNOTATIONS_PER_REQUEST));
  }
  return batches;
}

function annotationOf(annotation: StateAnnotation): CheckAnnotation {
  return {
    path: annotation.path,
    start_line: 1,
    end_line: 1,
    annotation_level: annotation.level,
    title: annotation.title.slice(0, 255),
    message: annotation.message,
    raw_details: annotation.url,
  };
}
