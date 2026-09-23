import type { Build } from "@storyshelf/core/schema";
import type { Comment } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Button } from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Snapshot comment thread props. */
export interface DiffCommentsProps {
  project: Project;
  build: Build;
  selectedId: string;
  comments: Comment[];
  canReview: boolean;
}

interface CommentCardProps {
  project: Project;
  build: Build;
  comment: Comment;
  canReview: boolean;
}

/** One comment with an optional resolve action. */
function CommentCard(props: CommentCardProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, comment, canReview } = props;
  return (
    <div key={comment.id} class="comment">
      <div class="comment__head">
        <strong>{comment.userId ?? "anonymous"}</strong>
        <span>· {new Date(comment.createdAt).toLocaleString()}</span>
        {comment.resolved ? <Badge tone="success">resolved</Badge> : null}
      </div>
      <p class="comment__body">{comment.body}</p>
      {!comment.resolved && canReview ? (
        <form
          method="post"
          action={`/api/v1/projects/${project.slug}/builds/${build.id}/comments/${comment.id}/resolve`}
          hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/comments/${comment.id}/resolve`}
          hx-target="body"
          class="comment__actions"
        >
          <Button variant="ghost" size="sm" type="submit">
            Mark resolved
          </Button>
        </form>
      ) : null}
    </div>
  );
}

interface CommentFormProps {
  project: Project;
  build: Build;
  selectedId: string;
}

/** Reply form scoped to the selected snapshot. */
function CommentForm(props: CommentFormProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selectedId } = props;
  return (
    <form
      method="post"
      action={`/api/v1/projects/${project.slug}/builds/${build.id}/comments`}
      hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/comments`}
      hx-target="body"
      class="stack mt-1"
    >
      <input type="hidden" name="snapshotId" value={selectedId} />
      <label class="field__label" for="comment-body">
        Add comment
      </label>
      <textarea
        class="field__input field__input--textarea"
        id="comment-body"
        name="body"
        rows={3}
        required
        placeholder="Leave feedback on this snapshot…"
      />
      <div>
        <Button variant="primary" type="submit">
          Comment
        </Button>
      </div>
    </form>
  );
}

/** Threaded comments for the selected snapshot plus the reply form. */
export function DiffComments(
  props: DiffCommentsProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selectedId, comments, canReview } = props;
  const visible = comments.filter((c) => !c.snapshotId || c.snapshotId === selectedId);
  return (
    <div class="card card--padded">
      <h3 class="review-bar__title">Comments</h3>
      <div class="stack">
        {visible.map((comment): HtmlEscapedString | Promise<HtmlEscapedString> => (
          <CommentCard
            key={comment.id}
            project={project}
            build={build}
            comment={comment}
            canReview={canReview}
          />
        ))}
        {visible.length === 0 ? <p class="field__hint">No comments on this snapshot.</p> : null}
      </div>

      <CommentForm project={project} build={build} selectedId={selectedId} />
    </div>
  );
}
