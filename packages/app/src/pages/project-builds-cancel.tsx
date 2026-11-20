import type { Build, Project } from "@storyshelf/core/schema";
import { CANCELLABLE_BUILD_STATUSES } from "@storyshelf/core/types";
import type { HtmlEscapedString } from "hono/utils/html";
import { selectOlderUnfinished } from "../routers/builds-cancel-bulk.ts";
import { Button } from "../ui/components.tsx";

/** How many unfinished builds "Cancel older unfinished builds" would cancel (the newest of each branch stays). */
export function olderUnfinishedCount(builds: readonly Build[]): number {
  const unfinished = builds.filter((build) => CANCELLABLE_BUILD_STATUSES.includes(build.status));
  return selectOlderUnfinished(unfinished, 1).length;
}

/**
 * The bulk-cancel action of the builds page: one post to `…/builds/cancel` behind a confirm that
 * names the count. The page shows it only to a viewer who may cancel, and only when something would be cancelled.
 */
export function CancelOlderBuilds(props: {
  project: Project;
  count: number;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, count } = props;
  const action = `/api/v1/projects/${project.slug}/builds/cancel`;
  const noun = count === 1 ? "build" : "builds";
  return (
    <form
      method="post"
      action={action}
      hx-post={action}
      hx-target="body"
      hx-confirm={`Cancel ${count} older unfinished ${noun}? The newest unfinished build of each branch keeps running.`}
    >
      <Button variant="secondary" type="submit">
        Cancel older unfinished builds ({count})
      </Button>
    </form>
  );
}
