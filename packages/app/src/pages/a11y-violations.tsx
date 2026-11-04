import {
  axeUnavailableReason,
  baselineSha,
  isA11yNote,
  parametersReason,
} from "@storyshelf/core/capture";
import type { Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Alert, Badge, Meta } from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** The axe violation texts stored on a snapshot (`rule (impact): help [selector] n node(s)`); empty when none. */
export function a11yViolationsOf(snapshot: Pick<Snapshot, "a11yViolations">): string[] {
  if (!snapshot.a11yViolations) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(snapshot.a11yViolations);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Whether a stored entry is the marker a runner writes when axe could not run
 * (`axe unavailable: <reason>`). It is a note about the run, never a finding.
 */
export function isAxeUnavailable(text: string): boolean {
  return axeUnavailableReason(text) !== undefined;
}

/**
 * The entries of a snapshot that are findings: every note (`axe unavailable`, `a11y parameters not
 * serializable` and `from baseline <sha>`) is left out. The one place that decides what a finding is.
 */
export function a11yFindingsOf(snapshot: Pick<Snapshot, "a11yViolations">): string[] {
  return a11yViolationsOf(snapshot).filter((text) => !isA11yNote(text));
}

/** The reason axe did not run on a snapshot, or `undefined` when it ran (or nothing is recorded). */
export function a11yUnavailableReasonOf(
  snapshot: Pick<Snapshot, "a11yViolations">,
): string | undefined {
  return a11yViolationsOf(snapshot)
    .map((text) => axeUnavailableReason(text))
    .find((reason) => reason !== undefined);
}

/** Why the story's `parameters.a11y` was not applied (axe ran with its defaults), if a runner said so. */
export function a11yParametersNoteOf(
  snapshot: Pick<Snapshot, "a11yViolations">,
): string | undefined {
  return a11yViolationsOf(snapshot)
    .map((text) => parametersReason(text))
    .find((reason) => reason !== undefined);
}

/**
 * The short sha of the baseline build whose findings an inherited snapshot shows, or `undefined`
 * when the findings were measured on this build. Such findings are never counted as fresh.
 */
export function a11yBaselineShaOf(snapshot: Pick<Snapshot, "a11yViolations">): string | undefined {
  return a11yViolationsOf(snapshot)
    .map((text) => baselineSha(text))
    .find((sha) => sha !== undefined);
}

/**
 * The snapshot that carries the axe findings of a story across its browser targets: axe runs on the
 * primary target only, so the findings sit on one sibling. The given snapshot first, else the first
 * sibling with findings, else whichever carries an `axe unavailable` note, else the given one.
 */
export function a11yCarrierOf<T extends Pick<Snapshot, "a11yViolations">>(
  snapshot: T,
  siblings: readonly T[],
): T {
  const found = (candidate: T): boolean => a11yFindingsOf(candidate).length > 0;
  const unavailable = (candidate: T): boolean => a11yUnavailableReasonOf(candidate) !== undefined;
  if (found(snapshot)) {
    return snapshot;
  }
  // Findings win over an `axe unavailable` note, which only shows when nothing found anything.
  return (
    siblings.find((sibling) => found(sibling)) ??
    (unavailable(snapshot) ? snapshot : siblings.find((sibling) => unavailable(sibling))) ??
    snapshot
  );
}

/** What axe found across a build, for its summary: information only, never part of a status. */
export interface A11ySummary {
  /** Findings measured on this build, summed over its snapshots (axe runs on the primary target only, so none repeat). */
  findings: number;
  /** Snapshots that carry at least one finding measured on this build. */
  snapshots: number;
  /** Findings shown on inherited snapshots: measured on their baseline, not on this build. */
  fromBaseline: number;
  /** Inherited snapshots that show findings from their baseline. */
  baselineSnapshots: number;
  /** Snapshots on which axe did not run (`axe unavailable`); never counted as findings. */
  unavailable: number;
}

const OVERFLOW_LINE = /^…and (\d+) more$/u;

/** Violations behind a stored list: its overflow line `…and N more` stands for N omitted violations. */
export function a11yCountOf(snapshot: Pick<Snapshot, "a11yViolations">): number {
  let count = 0;
  for (const text of a11yFindingsOf(snapshot)) {
    const omitted = OVERFLOW_LINE.exec(text)?.[1];
    count += omitted === undefined ? 1 : Number(omitted);
  }
  return count;
}

/** The build-level totals of the findings stored on `snapshots`. */
export function a11ySummaryOf(snapshots: readonly Pick<Snapshot, "a11yViolations">[]): A11ySummary {
  const fresh = snapshots.filter((snapshot) => a11yBaselineShaOf(snapshot) === undefined);
  const inherited = snapshots.filter((snapshot) => a11yBaselineShaOf(snapshot) !== undefined);
  const counts = fresh.map((snapshot) => a11yCountOf(snapshot));
  const carried = inherited.map((snapshot) => a11yCountOf(snapshot));
  return {
    findings: counts.reduce((sum, count) => sum + count, 0),
    snapshots: counts.filter((count) => count > 0).length,
    fromBaseline: carried.reduce((sum, count) => sum + count, 0),
    baselineSnapshots: carried.filter((count) => count > 0).length,
    unavailable: snapshots.filter((snapshot) => a11yUnavailableReasonOf(snapshot) !== undefined)
      .length,
  };
}

/**
 * The line under the build-level total. A snapshot stores nothing when axe found nothing and when it
 * did not run (a11y off, capture unfinished), so a zero never claims "none found".
 */
export function a11ySummaryNote(summary: A11ySummary): string {
  const base =
    summary.findings > 0
      ? `On ${summary.snapshots} ${summary.snapshots === 1 ? "snapshot" : "snapshots"}. Information only; they never change the status.`
      : "No findings recorded. Information only.";
  const withBaseline =
    summary.fromBaseline > 0 ? `${base} ${a11yBaselineNote(summary.baselineSnapshots)}` : base;
  return summary.unavailable > 0
    ? `${withBaseline} ${a11yUnavailableNote(summary.unavailable)}`
    : withBaseline;
}

/** The neutral line for runs where axe did not run; the reason sits on each snapshot. */
export function a11yUnavailableNote(count: number): string {
  return `axe did not run on ${count} ${count === 1 ? "snapshot" : "snapshots"}.`;
}

/** The neutral line for inherited snapshots: their findings come from the baseline, not from this build. */
export function a11yBaselineNote(count: number): string {
  return `${count} inherited ${count === 1 ? "snapshot shows" : "snapshots show"} findings from the baseline, not measured on this build.`;
}

/** " on <target>" for the findings of a snapshot: axe runs on the primary target only, so say which. */
function onTarget(snapshot: Pick<Snapshot, "browser">): string {
  return snapshot.browser ? ` on ${snapshot.browser}` : "";
}

/** The line explaining why the story's own a11y configuration was not applied. */
function parametersLine(reason: string): string {
  return `The story's a11y parameters could not be read (${reason}), so axe ran with its defaults.`;
}

/** Heading count for findings: "2 found on chromium", or "2 from baseline abc1234" for inherited ones. */
function foundText(snapshot: Pick<Snapshot, "a11yViolations" | "browser">): string {
  const sha = a11yBaselineShaOf(snapshot);
  const count = a11yCountOf(snapshot);
  return sha === undefined
    ? `${count} found${onTarget(snapshot)} (does not block)`
    : `${count} from baseline ${sha} (not measured on this build; does not block)`;
}

/** Review-page note above the viewer: what axe found on this snapshot. It never blocks the build. */
export function A11yViolationsNotice(props: {
  snapshot: Pick<Snapshot, "a11yViolations" | "browser">;
}): Rendered | null {
  const violations = a11yFindingsOf(props.snapshot);
  const unavailable = a11yUnavailableReasonOf(props.snapshot);
  const parameters = a11yParametersNoteOf(props.snapshot);
  if (violations.length === 0) {
    if (unavailable === undefined && parameters === undefined) {
      return null;
    }
    return (
      <Alert
        tone="info"
        title={
          unavailable === undefined
            ? `Accessibility: story parameters not applied${onTarget(props.snapshot)}`
            : `Accessibility: axe did not run${onTarget(props.snapshot)}`
        }
      >
        {unavailable === undefined ? null : <code>{unavailable}</code>}
        {parameters === undefined ? null : <p>{parametersLine(parameters)}</p>}
      </Alert>
    );
  }
  return (
    <Alert tone="warning" title={`Accessibility: ${foundText(props.snapshot)}`}>
      <ul>
        {violations.map((text) => (
          <li key={text}>
            <code>{text}</code>
          </li>
        ))}
      </ul>
      {parameters === undefined ? null : <p>{parametersLine(parameters)}</p>}
    </Alert>
  );
}

/** Compact card version: a badge with the count and the findings behind a disclosure. */
export function A11yViolationsDetails(props: {
  snapshot: Pick<Snapshot, "a11yViolations" | "browser">;
}): Rendered | null {
  const violations = a11yFindingsOf(props.snapshot);
  const unavailable = a11yUnavailableReasonOf(props.snapshot);
  const parameters = a11yParametersNoteOf(props.snapshot);
  const sha = a11yBaselineShaOf(props.snapshot);
  if (violations.length === 0) {
    if (unavailable === undefined && parameters === undefined) {
      return null;
    }
    return (
      <details>
        <summary>
          <Badge tone="neutral">
            {unavailable === undefined ? "story parameters not applied" : "axe did not run"}
            {onTarget(props.snapshot)}
          </Badge>
        </summary>
        {unavailable === undefined ? null : (
          <Meta>
            <code>{unavailable}</code>
          </Meta>
        )}
        {parameters === undefined ? null : <Meta>{parametersLine(parameters)}</Meta>}
      </details>
    );
  }
  return (
    <details>
      <summary>
        <Badge tone="warning" icon>
          a11y {a11yCountOf(props.snapshot)}
          {sha === undefined ? onTarget(props.snapshot) : ` from baseline ${sha}`}
        </Badge>
      </summary>
      {violations.map((text) => (
        <Meta key={text}>
          <code>{text}</code>
        </Meta>
      ))}
      {parameters === undefined ? null : <Meta>{parametersLine(parameters)}</Meta>}
    </details>
  );
}
