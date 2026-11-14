// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { reviewComment, reviewData } from "../stories-fixtures/review.ts";
import { DiffComments, type DiffCommentsProps } from "./build-diff-comments.tsx";

const meta: Meta = { title: "Pages/Builds/Snapshot comments" };
export default meta;

/** The thread of the selected snapshot on the review page, with `extra` comments added to it. */
function thread(extra: DiffCommentsProps["comments"] = []): DiffCommentsProps {
  const data = reviewData();
  const selected = data.snapshots.find((snapshot) => snapshot.id === data.selectedId);
  return {
    project: data.project,
    build: data.build,
    selectedId: selected?.id ?? "",
    selectedStoryId: selected?.storyId,
    comments: [...data.comments, ...extra],
    canTriage: data.canTriage,
    names: data.names,
  };
}

/** The snapshot's thread and its comment box, as the review page renders it. */
export const Thread = jsxStory(() => <DiffComments {...thread()} />);

/** Just after posting: the card swapped in place, the new comment listed, the box empty and focused. */
export const AfterPosting = jsxStory(() => {
  const props = thread();
  const posted = reviewComment("POST", {
    kind: "comment",
    snapshotId: props.selectedId,
    body: "The focus ring is clipped on the left edge.",
  });
  return <DiffComments {...props} comments={[...props.comments, posted]} refocus />;
});
