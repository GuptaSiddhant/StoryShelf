import { CommentModel } from "@storyshelf/core/models";
import type { Build, CommentMention } from "@storyshelf/core/schema";
import type { Comment } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { mentionSpans } from "@storyshelf/core/utils";
import type { HtmlEscapedString } from "hono/utils/html";
import { mentionNamesOf } from "../mentions.ts";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Badge,
  Button,
  Card,
  CheckField,
  Meta,
  RelativeTime,
  SectionTitle,
  VStack,
} from "../ui/components.tsx";
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
  /** Whether the viewer may resolve and reopen comments. */
  canTriage: boolean;
  names?: ReadonlyMap<string, string>;
}

/** One comment's props: where it sits, and what its head shows beside the author. */
export interface CommentCardProps {
  project: Project;
  build: Build;
  comment: Comment;
  /** Whether the viewer may resolve and reopen it (developers and above, and the build's author). */
  canTriage: boolean;
  /** What the comment is anchored to (a story badge), shown in its head. */
  anchor?: unknown;
  /** Display names by user id; a user without one shows by id. */
  names?: ReadonlyMap<string, string>;
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

/** One comment; a change request carries a status badge and can be resolved and reopened. */
export function CommentCard(
  props: CommentCardProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { comment, anchor, names } = props;
  const who = nameOf(names, comment.userId, "anonymous");
  const folded = comment.kind === "change_request" && comment.resolved;
  return (
    <div key={comment.id} id={`comment-${comment.id}`} tabIndex={-1} class={reviewComment}>
      <div class={reviewCommentHead}>
        <strong>{who}</strong>
        <span>· {new Date(comment.createdAt).toLocaleString()}</span>
        {anchor ?? null}
        <KindBadge comment={comment} />
      </div>
      {folded ? (
        <details>
          <summary>
            <ResolvedLine comment={comment} names={names} />
          </summary>
          <p class={reviewCommentBody}>
            <CommentText comment={comment} />
          </p>
        </details>
      ) : (
        <p class={reviewCommentBody}>
          <CommentText comment={comment} />
        </p>
      )}
      {props.canTriage ? <TriageAction {...props} who={who} /> : null}
    </div>
  );
}

function nameOf(
  names: ReadonlyMap<string, string> | undefined,
  userId: string | null,
  fallback: string,
): string {
  return userId === null ? fallback : (names?.get(userId) ?? userId);
}

/** "Change requested" while open, "Resolved" once done; a plain comment shows only a resolved tag. */
function KindBadge(props: {
  comment: Comment;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { comment } = props;
  if (comment.kind !== "change_request") {
    return comment.resolved ? <Badge tone="success">resolved</Badge> : null;
  }
  return comment.resolved ? (
    <Badge tone="success" icon>
      Resolved
    </Badge>
  ) : (
    <Badge tone="warning" icon>
      Change requested
    </Badge>
  );
}

/** "Resolved by Ana · 2 hours ago", the one line a resolved change request folds to. */
function ResolvedLine(props: {
  comment: Comment;
  names: ReadonlyMap<string, string> | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { comment, names } = props;
  return (
    <>
      {comment.resolvedBy ? `Resolved by ${nameOf(names, comment.resolvedBy, "")}` : "Resolved"}
      {comment.resolvedAt ? (
        <>
          {" · "}
          <RelativeTime value={comment.resolvedAt} />
        </>
      ) : null}
    </>
  );
}

/** "Mark resolved" for an open comment, "Reopen" for a resolved one. */
function TriageAction(
  props: CommentCardProps & { who: string },
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, comment, who } = props;
  const verb = comment.resolved ? "reopen" : "resolve";
  const url = `/projects/${project.slug}/builds/${build.id}/comments/${comment.id}/${verb}`;
  const what = comment.kind === "change_request" ? "change request" : "comment";
  return (
    <form method="post" action={url} hx-post={url} hx-target="body" class={reviewCommentActions}>
      {csrfField()}
      <Button
        variant="ghost"
        size="sm"
        type="submit"
        aria-label={`${comment.resolved ? "Reopen" : "Mark"} ${who}'s ${what}${comment.resolved ? "" : " resolved"}`}
      >
        {comment.resolved ? "Reopen" : "Mark resolved"}
      </Button>
    </form>
  );
}

/** The "Request a change" box under a comment textarea; `id` keeps it unique when forms repeat. */
export function RequestChangeField(props: {
  id: string;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <CheckField
      id={props.id}
      name="kind"
      value="change_request"
      label="Request a change"
      hint="Asks the author to address this. It doesn't block approval."
    />
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
        <RequestChangeField id="snapshot-request-change" />
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
  const { project, build, selectedId, selectedStoryId, comments, canTriage, names } = props;
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
            canTriage={canTriage}
            names={names}
          />
        ))}
        {visible.length === 0 ? <Meta>No comments on this snapshot.</Meta> : null}
      </VStack>

      <CommentForm project={project} build={build} selectedId={selectedId} />
    </Card>
  );
}
