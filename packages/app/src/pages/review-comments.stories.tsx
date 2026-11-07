// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone } from "../../.storybook/page.tsx";
import { jsxStory } from "../../.storybook/render.tsx";
import { reviewComment, reviewSection } from "../stories-fixtures/review.ts";
import { hoursAgo } from "../stories-fixtures/time.ts";
import { ChangeRequestsCard } from "./review-change-requests.tsx";
import { CommentsCard } from "./review-comments.tsx";

const meta: Meta = { title: "Pages/Review/Comments" };
export default meta;

const openRequest = reviewComment("001", {
  body: "The corner radius looks off against the Figma frame. Please check before this ships.",
});
const resolvedRequest = reviewComment("002", {
  userId: "u_bo",
  body: "Focus ring is missing on the secondary button.",
  resolved: true,
  resolvedBy: "u_ana",
  resolvedAt: hoursAgo(2),
});
const storyRequest = reviewComment("003", {
  userId: "u_cy",
  storyId: "kit-button--primary",
  body: "Disabled state needs a visible border in dark mode, the text alone fails contrast on the new surface colour.",
  createdAt: hoursAgo(3),
});
const plain = reviewComment("004", {
  kind: "comment",
  userId: "u_bo",
  body: "Looks good to me otherwise.",
  createdAt: hoursAgo(1),
});

/** No comments yet, and the viewer may comment. */
export const NoComments = jsxStory(() => <CommentsCard data={reviewSection()} />);

/** No comments, and the viewer may not comment. */
export const NoCommentsReadOnly = jsxStory(() => (
  <CommentsCard data={reviewSection({ canComment: false, canTriage: false })} />
));

/** An open change request, a resolved one folded to a line, a story request and a plain comment. */
export const Thread = jsxStory(() => (
  <CommentsCard
    data={reviewSection({ comments: [openRequest, resolvedRequest, storyRequest, plain] })}
  />
));

/** The same thread for a viewer who may not resolve or reopen: no triage buttons. */
export const ThreadReadOnly = jsxStory(() => (
  <CommentsCard
    data={reviewSection({
      comments: [openRequest, resolvedRequest, storyRequest, plain],
      canTriage: false,
      canComment: false,
    })}
  />
));

/** The checklist of open requests with the resolved ones folded under it. */
export const ChecklistMixed = jsxStory(() => (
  <ChangeRequestsCard
    data={reviewSection({ changeRequests: [openRequest, storyRequest, resolvedRequest] })}
  />
));

/** Every request resolved: one line instead of the list. */
export const ChecklistAllResolved = jsxStory(() => (
  <ChangeRequestsCard data={reviewSection({ changeRequests: [resolvedRequest] })} />
));

/** The thread and the checklist on a 375px phone: long text wraps and nothing scrolls sideways. */
export const ThreadOnAPhone = onAPhone(Thread);
export const ChecklistOnAPhone = onAPhone(ChecklistMixed);
