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

/** Review-page note above the viewer: what axe found on this snapshot. It never blocks the build. */
export function A11yViolationsNotice(props: {
  snapshot: Pick<Snapshot, "a11yViolations">;
}): Rendered | null {
  const violations = a11yViolationsOf(props.snapshot);
  if (violations.length === 0) {
    return null;
  }
  return (
    <Alert tone="warning" title={`Accessibility: ${violations.length} found (does not block)`}>
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
  snapshot: Pick<Snapshot, "a11yViolations">;
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
