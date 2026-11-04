import type { RetentionPause } from "@storyshelf/core/adapter/database";
import type { HtmlEscapedString } from "hono/utils/html";
import { Alert } from "../ui/components.tsx";

const WHY: Record<RetentionPause["problem"], string> = {
  tombstoned: "is being deleted",
  "other-project": "belongs to another project",
};

/**
 * Build retention stays off at boot when a baseline's recorded source build cannot be pinned
 * (ADR 0039): the database withholds the lifecycle capability, so no build is purged.
 */
export function RetentionPausedNotice(props: {
  pause: RetentionPause | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { pause } = props;
  return pause ? (
    <Alert tone="warning" title="Retention is paused">
      Retention is paused: baseline <code>{pause.baselineId}</code> has an invalid source build{" "}
      <code>{pause.buildId}</code> (it {WHY[pause.problem]}). No build is purged meanwhile. Remove
      or repoint that baseline, then restart the server; retention turns on at the next boot.
    </Alert>
  ) : null;
}
