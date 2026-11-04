import type { NotifierState, StateAnnotation } from "@storyshelf/core/adapter/notifier";
/** Pure mapping from a desired status to GitHub check-run payloads (never posts anything). */
import { createHash } from "node:crypto";

/** GitHub accepts at most this many annotations per request. */
export const ANNOTATIONS_PER_REQUEST = 50;

/** Most current findings the summary spells out; the annotations carry all of them. */
export const FINDINGS_LISTED = 25;

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
  /**
   * Annotations already on the run that no longer match a current finding. GitHub keeps every
   * annotation of a run, so the summary says how many are history.
   */
  resolved?: number | undefined;
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

/**
 * The summary: the description, then the current findings, then the link to the build with what
 * the annotations leave out, then how many earlier annotations on the run are history. A run
 * that carries findings ends with the hash of the set, which tells the next post whether the
 * annotations are still the current ones.
 */
export function summaryOf(input: CheckRunInput): string {
  const lines = [input.description, findingsLines(input.annotations ?? []), linkLine(input)];
  if ((input.resolved ?? 0) > 0) {
    lines.push(earlierLine(input.resolved ?? 0));
  }
  if (input.annotations !== undefined) {
    lines.push(findingsMarker(input.annotations));
  }
  return lines.filter((line) => line !== undefined).join("\n\n");
}

/** The link to the build, with what the annotations leave out. */
function linkLine(input: Pick<CheckRunInput, "url" | "omitted">): string | undefined {
  const omitted = input.omitted ?? 0;
  if (omitted > 0) {
    const more = `and ${String(omitted)} more changed snapshots`;
    return input.url === undefined ? more : `${more}: [open the build](${input.url})`;
  }
  return input.url === undefined ? undefined : `[Open the build](${input.url})`;
}

function findingsLines(annotations: readonly StateAnnotation[]): string | undefined {
  if (annotations.length === 0) {
    return undefined;
  }
  const shown = annotations
    .slice(0, FINDINGS_LISTED)
    .map((annotation) => `- ${annotation.title} (\`${annotation.path}\`)`);
  const rest = annotations.length - shown.length;
  const head = `Current findings (${String(annotations.length)}):`;
  return [head, ...shown, ...(rest > 0 ? [`- and ${String(rest)} more`] : [])].join("\n");
}

function earlierLine(count: number): string {
  const subject =
    count === 1 ? "1 earlier annotation belongs" : `${String(count)} earlier annotations belong`;
  return `${subject} to findings that have since changed or been resolved. GitHub keeps a run's annotations, so they stay on the run.`;
}

/** What identifies a finding on a run: the same fields the annotation shows. */
export function findingKey(parts: {
  level: string;
  path: string;
  title: string;
  message: string;
  url: string;
}): string {
  return [parts.level, parts.path, parts.title.slice(0, 255), parts.message, parts.url].join("\0");
}

/** The hash of a finding set; it does not depend on the order of the findings. */
export function findingsHash(annotations: readonly StateAnnotation[]): string {
  const keys = annotations.map((annotation) => findingKey(annotation)).toSorted();
  return createHash("sha256").update(keys.join("\n")).digest("hex").slice(0, 16);
}

const MARKER = /<!-- storyshelf:findings=(?<hash>[0-9a-f]+) -->/u;

function findingsMarker(annotations: readonly StateAnnotation[]): string {
  return `<!-- storyshelf:findings=${findingsHash(annotations)} -->`;
}

/**
 * The body without the finding-set hash. The hash tells the next post that the run shows the whole
 * set, so it goes on only with the write that completes the annotations, and never on a run that
 * only mirrors the state (a duplicate that carries no annotations).
 */
export function withoutMarker(body: CheckRunBody): CheckRunBody {
  const summary = body.output.summary.replace(/\n\n<!-- storyshelf:findings=[0-9a-f]+ -->$/u, "");
  return { ...body, output: { ...body.output, summary } };
}

/** The finding-set hash a run's summary ends with, if it has one. */
export function markedHash(summary: string | null | undefined): string | undefined {
  return MARKER.exec(summary ?? "")?.groups?.["hash"];
}

/** Annotations as batches of at most {@link ANNOTATIONS_PER_REQUEST}. */
export function annotationBatches(annotations: readonly StateAnnotation[]): CheckAnnotation[][] {
  const pending = annotations.map((annotation) => annotationOf(annotation));
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
