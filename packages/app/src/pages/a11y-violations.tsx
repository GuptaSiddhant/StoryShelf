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

const UNAVAILABLE_PREFIX = "axe unavailable: ";

/**
 * Whether a stored entry is the marker a runner writes when axe could not run
 * (`axe unavailable: <reason>`). It is a note about the run, never a finding: the one place that
 * knows the marker's shape.
 */
export function isAxeUnavailable(text: string): boolean {
  return text.startsWith(UNAVAILABLE_PREFIX);
}

/** The entries of a snapshot that are findings (the `axe unavailable` markers left out). */
export function a11yFindingsOf(snapshot: Pick<Snapshot, "a11yViolations">): string[] {
  return a11yViolationsOf(snapshot).filter((text) => !isAxeUnavailable(text));
}

/** The reason axe did not run on a snapshot, or `undefined` when it ran (or nothing is recorded). */
export function a11yUnavailableReasonOf(
  snapshot: Pick<Snapshot, "a11yViolations">,
): string | undefined {
  const marker = a11yViolationsOf(snapshot).find((text) => isAxeUnavailable(text));
  return marker?.slice(UNAVAILABLE_PREFIX.length);
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
  /** Findings summed over every snapshot (axe runs on the primary target only, so none repeat). */
  findings: number;
  /** Snapshots that carry at least one finding. */
  snapshots: number;
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
  const counts = snapshots.map((snapshot) => a11yCountOf(snapshot));
  return {
    findings: counts.reduce((sum, count) => sum + count, 0),
    snapshots: counts.filter((count) => count > 0).length,
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
  return summary.unavailable > 0 ? `${base} ${a11yUnavailableNote(summary.unavailable)}` : base;
}

/** The neutral line for runs where axe did not run; the reason sits on each snapshot. */
export function a11yUnavailableNote(count: number): string {
  return `axe did not run on ${count} ${count === 1 ? "snapshot" : "snapshots"}.`;
}

/** " on <target>" for the findings of a snapshot: axe runs on the primary target only, so say which. */
function onTarget(snapshot: Pick<Snapshot, "browser">): string {
  return snapshot.browser ? ` on ${snapshot.browser}` : "";
}

/** Review-page note above the viewer: what axe found on this snapshot. It never blocks the build. */
export function A11yViolationsNotice(props: {
  snapshot: Pick<Snapshot, "a11yViolations" | "browser">;
}): Rendered | null {
  const violations = a11yFindingsOf(props.snapshot);
  const unavailable = a11yUnavailableReasonOf(props.snapshot);
  if (violations.length === 0) {
    return unavailable === undefined ? null : (
      <Alert tone="info" title={`Accessibility: axe did not run${onTarget(props.snapshot)}`}>
        <code>{unavailable}</code>
      </Alert>
    );
  }
  return (
    <Alert
      tone="warning"
      title={`Accessibility: ${a11yCountOf(props.snapshot)} found${onTarget(props.snapshot)} (does not block)`}
    >
      <ul>
        {violations.map((text) => (
          <li key={text}>
            <code>{text}</code>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/** Compact card version: a badge with the count and the findings behind a disclosure. */
export function A11yViolationsDetails(props: {
  snapshot: Pick<Snapshot, "a11yViolations" | "browser">;
}): Rendered | null {
  const violations = a11yFindingsOf(props.snapshot);
  const unavailable = a11yUnavailableReasonOf(props.snapshot);
  if (violations.length === 0) {
    return unavailable === undefined ? null : (
      <details>
        <summary>
          <Badge tone="neutral">axe did not run{onTarget(props.snapshot)}</Badge>
        </summary>
        <Meta>
          <code>{unavailable}</code>
        </Meta>
      </details>
    );
  }
  return (
    <details>
      <summary>
        <Badge tone="warning" icon>
          a11y {a11yCountOf(props.snapshot)}
          {onTarget(props.snapshot)}
        </Badge>
      </summary>
      {violations.map((text) => (
        <Meta key={text}>
          <code>{text}</code>
        </Meta>
      ))}
    </details>
  );
}
