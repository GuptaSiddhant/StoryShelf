import type { RetentionPause } from "@storyshelf/core/adapter/database";
import type { HtmlEscapedString } from "hono/utils/html";
import { Alert } from "../ui/components.tsx";

const WHY: Record<RetentionPause["problem"], string> = {
  tombstoned: "which is being deleted",
  "other-project": "which belongs to another project",
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
      Baseline <code>{pause.baselineId}</code> points at build <code>{pause.buildId}</code>,{" "}
      {WHY[pause.problem]}, so StoryShelf cannot tell which builds are safe to purge. No build is
      purged until you remove or repoint that baseline and restart the server; retention then turns
      on at the next boot. Check this page again after restarting: another baseline may still need
      fixing.
    </Alert>
  ) : null;
}
