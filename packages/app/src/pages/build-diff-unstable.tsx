import type { Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Alert, Badge } from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Unstable = Pick<Snapshot, "unstable">;

/** Whether a second render of this changed snapshot differed from the first (advisory only). */
export function isUnstable(snapshot: Unstable): boolean {
  return snapshot.unstable === true;
}

/** The snapshot's flag, in the viewer's meta line. */
export function UnstableBadge(props: {
  snapshot: Unstable;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  return isUnstable(props.snapshot) ? (
    <Badge tone="warning" icon>
      Unstable render: likely flaky
    </Badge>
  ) : null;
}

/** Why the flag is there and what to do about it; the change still needs review as usual. */
export function UnstableNotice(props: {
  snapshot: Unstable;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  if (!isUnstable(props.snapshot)) return null;
  return (
    <Alert tone="warning" title="This change may be noise">
      Rendering this story a second time gave a different image, so the difference may come from the
      story, not from your change. Hide the unstable part with an ignore region (
      <code>data-storyshelf-ignore</code> or <code>ignoreSelectors</code>), or mark the story{" "}
      <code>flakyTest</code>. It still needs review like any other change.
    </Alert>
  );
}
