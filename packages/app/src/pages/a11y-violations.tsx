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
 * The snapshot that carries the axe findings of a story across its browser targets: axe runs on the
 * primary target only, so the findings sit on one sibling. The given snapshot first, else the first
 * sibling with findings, else the given one.
 */
export function a11yCarrierOf<T extends Pick<Snapshot, "a11yViolations">>(
  snapshot: T,
  siblings: readonly T[],
): T {
  if (a11yViolationsOf(snapshot).length > 0) {
    return snapshot;
  }
  return siblings.find((sibling) => a11yViolationsOf(sibling).length > 0) ?? snapshot;
}

/** " on <target>" for the findings of a snapshot: axe runs on the primary target only, so say which. */
function onTarget(snapshot: Pick<Snapshot, "browser">): string {
  return snapshot.browser ? ` on ${snapshot.browser}` : "";
}

/** Review-page note above the viewer: what axe found on this snapshot. It never blocks the build. */
export function A11yViolationsNotice(props: {
  snapshot: Pick<Snapshot, "a11yViolations" | "browser">;
}): Rendered | null {
  const violations = a11yViolationsOf(props.snapshot);
  if (violations.length === 0) {
    return null;
  }
  return (
    <Alert
      tone="warning"
      title={`Accessibility: ${violations.length} found${onTarget(props.snapshot)} (does not block)`}
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
  const violations = a11yViolationsOf(props.snapshot);
  if (violations.length === 0) {
    return null;
  }
  return (
    <details>
      <summary>
        <Badge tone="warning" icon>
          a11y {violations.length}
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
