import { CommentModel } from "@storyshelf/core/models";
import type { Build, CommentMention } from "@storyshelf/core/schema";
import type { Comment } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { mentionSpans } from "@storyshelf/core/utils";
import type { HtmlEscapedString } from "hono/utils/html";
import { mentionNamesOf } from "../mentions.ts";
import { Badge, Button, Card, Meta, SectionTitle, VStack } from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";
import {
  reviewComment,
  reviewCommentActions,
  reviewCommentBody,
  reviewCommentHead,
  reviewMention,
} from "../ui/styles/review.ts";
import { CommentBodyField } from "./comment-body-field.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Snapshot comment thread props. */
export interface DiffCommentsProps {
  project: Project;
  build: Build;
  selectedId: string;
  /** Story of the selected snapshot: its story comments show here too (ADR 0013, decision 2). */
  selectedStoryId?: string;
  comments: Comment[];
  canReview: boolean;
}

/** One comment's props: where it sits, and what its head shows beside the author. */
export interface CommentCardProps {
  project: Project;
  build: Build;
  comment: Comment;
  canReview: boolean;
  /** What the comment is anchored to (a story badge), shown in its head. */
  anchor?: unknown;
}

/** The body cut at each mention span, the mentions as highlighted names. */
function highlighted(
  body: string,
  mentions: readonly CommentMention[],
  names: ReadonlyMap<string, string>,
): unknown[] {
  const parts: unknown[] = [];
  let at = 0;
  for (const span of mentionSpans(body, mentions)) {
    const name = names.get(span.userId);
    const label = name === undefined ? body.slice(span.start, span.end) : `@${name}`;
    parts.push(body.slice(at, span.start), <span class={reviewMention}>{label}</span>);
    at = span.end;
  }
  parts.push(body.slice(at));
  return parts;
}

/**
 * A comment's text, the members it mentions highlighted (#463). The stored mentions are ids, so
 * the highlight shows each member's current name; text that was plain when posted stays plain.
 */
async function CommentText(props: { comment: Comment }): Promise<HtmlEscapedString> {
  const mentions = CommentModel.mentionsOf(props.comment);
  if (mentions.length === 0) {
    return <>{props.comment.body}</>;
  }
  return <>{highlighted(props.comment.body, mentions, await mentionNamesOf(mentions))}</>;
}

/** One comment with an optional resolve action. */
export function CommentCard(
  props: CommentCardProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, comment, canReview, anchor } = props;
  return (
    <div key={comment.id} class={reviewComment}>
      <div class={reviewCommentHead}>
        <strong>{comment.userId ?? "anonymous"}</strong>
        <span>· {new Date(comment.createdAt).toLocaleString()}</span>
        {anchor ?? null}
        {comment.resolved ? <Badge tone="success">resolved</Badge> : null}
      </div>
      <p class={reviewCommentBody}>
        <CommentText comment={comment} />
      </p>
      {!comment.resolved && canReview ? (
        <form
          method="post"
          action={`/projects/${project.slug}/builds/${build.id}/comments/${comment.id}/resolve`}
          hx-post={`/projects/${project.slug}/builds/${build.id}/comments/${comment.id}/resolve`}
          hx-target="body"
          class={reviewCommentActions}
        >
          {csrfField()}
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
      action={`/projects/${project.slug}/builds/${build.id}/comments`}
      hx-post={`/projects/${project.slug}/builds/${build.id}/comments`}
      hx-target="body"
      class="mt-1"
    >
      {csrfField()}
      <VStack>
        <input type="hidden" name="snapshotId" value={selectedId} />
        <CommentBodyField slug={project.slug} buildId={build.id} kind="snapshot" />
        <div>
          <Button variant="primary" type="submit">
            Comment
          </Button>
        </div>
      </VStack>
    </form>
  );
}

/** Threaded comments for the selected snapshot plus the reply form. */
export function DiffComments(
  props: DiffCommentsProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selectedId, selectedStoryId, comments, canReview } = props;
  const visible = comments.filter((c) =>
    c.snapshotId ? c.snapshotId === selectedId : !c.storyId || c.storyId === selectedStoryId,
  );
  return (
    <Card>
      <SectionTitle level={3}>Comments</SectionTitle>
      <VStack>
        {visible.map((comment): HtmlEscapedString | Promise<HtmlEscapedString> => (
          <CommentCard
            key={comment.id}
            project={project}
            build={build}
            comment={comment}
            canReview={canReview}
          />
        ))}
        {visible.length === 0 ? <Meta>No comments on this snapshot.</Meta> : null}
      </VStack>

      <CommentForm project={project} build={build} selectedId={selectedId} />
    </Card>
  );
}
