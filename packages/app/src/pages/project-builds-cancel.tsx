import type { Build } from "@storyshelf/core/schema";
import { selectOlderUnfinished } from "@storyshelf/core/types";
import type { HtmlEscapedString } from "hono/utils/html";
import { csrfField } from "../shell/csrf-field.tsx";
import { Button } from "../ui/components.tsx";

/** How many unfinished builds "Cancel older unfinished builds" would cancel (the newest of each branch stays). */
export function olderUnfinishedCount(builds: readonly Build[]): number {
  return selectOlderUnfinished(builds, 1).length;
}

/**
 * The bulk-cancel action of the builds page: one post to the page route `action` behind a confirm
 * that names the count. The page shows it only to a viewer who may cancel, and only when something
 * would be cancelled; the count is the route's own selection over the project's builds.
 */
export function CancelOlderBuilds(props: {
  action: string;
  count: number;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { action, count } = props;
  const noun = count === 1 ? "build" : "builds";
  return (
    <form
      method="post"
      action={action}
      hx-post={action}
      hx-target="body"
      hx-confirm={`Cancel ${count} older unfinished ${noun}? The newest unfinished build of each branch keeps running.`}
    >
      {csrfField()}
      <Button variant="secondary" type="submit">
        Cancel older unfinished builds ({count})
      </Button>
    </form>
  );
}
