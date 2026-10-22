/** Build and story comments (ADR 0013, decision 2): the build page card and the story thread. */
import type { Build, Comment, Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import type { ReviewSectionData } from "../routers/review-section.handlers.ts";
import {
  Badge,
  Button,
  Card,
  Meta,
  SectionTitle,
  TextareaField,
  VStack,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";
import { CommentCard } from "./build-diff-comments.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Comments on the build as a whole and on its stories, with a form for a build comment. */
export function CommentsCard(props: { data: ReviewSectionData }): Rendered {
  const { data } = props;
  const { project, build, comments, canComment } = data;
  return (
    <Card>
      <SectionTitle>Comments</SectionTitle>
      {comments.length === 0 ? (
        <Meta>
          No comments yet.{" "}
          {canComment
            ? "Comment on the build here, or on a story from its component page."
            : "Developers, approvers and admins can comment."}
        </Meta>
      ) : null}
      <VStack>
        {comments.map((comment): Rendered => (
          <CommentCard
            key={comment.id}
            project={project}
            build={build}
            comment={comment}
            canReview={canComment}
            anchor={
              <Badge tone="neutral">{comment.storyId ? `story ${comment.storyId}` : "build"}</Badge>
            }
          />
        ))}
      </VStack>
      {canComment ? <CommentForm project={project} build={build} storyId={undefined} /> : null}
    </Card>
  );
}

/** The comments of one story in the build a component page shows, with a form to add one. */
export function StoryComments(props: {
  project: Project;
  build: Build;
  storyId: string;
  comments: readonly Comment[];
  canComment: boolean;
}): Rendered {
  const { project, build, storyId, canComment } = props;
  const comments = props.comments.filter((comment) => comment.storyId === storyId);
  return (
    <Card id="story-comments">
      <SectionTitle>Comments on this story</SectionTitle>
      <Meta>On build {build.gitSha.slice(0, 7)}.</Meta>
      {comments.length === 0 ? <Meta>No comments on this story yet.</Meta> : null}
      <VStack>
        {comments.map((comment): Rendered => (
          <CommentCard
            key={comment.id}
            project={project}
            build={build}
            comment={comment}
            canReview={canComment}
          />
        ))}
      </VStack>
      {canComment ? <CommentForm project={project} build={build} storyId={storyId} /> : null}
    </Card>
  );
}

function CommentForm(props: {
  project: Project;
  build: Build;
  storyId: string | undefined;
}): Rendered {
  const { project, build, storyId } = props;
  const url = `/projects/${project.slug}/builds/${build.id}/comments`;
  return (
    <form method="post" action={url} hx-post={url} hx-target="body" class="mt-1 max-w-prose">
      {csrfField()}
      <VStack>
        {storyId ? <input type="hidden" name="storyId" value={storyId} /> : null}
        <TextareaField
          label={storyId ? "Add story comment" : "Add build comment"}
          name="body"
          id={storyId ? "story-comment-body" : "build-comment-body"}
          rows={3}
          required
          placeholder={
            storyId ? "Leave a comment on this story…" : "Leave a comment on this build…"
          }
        />
        <div>
          <Button variant="primary" type="submit">
            Comment
          </Button>
        </div>
      </VStack>
    </form>
  );
}
