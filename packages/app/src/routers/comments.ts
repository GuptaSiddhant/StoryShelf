import { createRoute, z } from "@hono/zod-openapi";
import { CommentModel, type CommentCreateInput } from "@storyshelf/core/models";
import type { Comment, CommentMention, Project } from "@storyshelf/core/schema";
import { resolveMentions, type FoundMention } from "@storyshelf/core/utils";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { displayNameOf, mentionCandidates, mentionData } from "../mentions.ts";
import { REVIEW_EVENTS, announceMention, announceReview } from "../review-events.ts";
import { getStore } from "../store.ts";
import { VIEW_ROLES, DEVELOPER_ROLES, buildForProject } from "./builds.handlers.ts";
import { resolveTriager } from "./comment-triage.ts";
import { flashHx } from "./flash.ts";
import { resolveAuthorizedProject, notFound as throwNotFound } from "./helpers.ts";
import { hxRefresh } from "./htmx.ts";
import { commentSchema, commentCreateSchema, notFound, unauthorized } from "./schemas.ts";
const listCommentsRoute = createRoute({
  method: "get",
  tags: ["Review"],
  summary: "List comments",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: commentSchema.array() } },
      description: "List comments on a build",
    },
    ...notFound,
    ...unauthorized,
  },
});

const createCommentRoute = createRoute({
  method: "post",
  tags: ["Review"],
  summary: "Add a comment",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments",
  request: {
    params: z.object({ slug: z.string(), buildId: z.string() }),
    body: { content: { "application/json": { schema: commentCreateSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: commentSchema } },
      description: "Comment created",
    },
    ...notFound,
  },
});

const resolveCommentRoute = createRoute({
  method: "post",
  tags: ["Review"],
  summary: "Resolve a comment",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments/{commentId}/resolve",
  request: { params: z.object({ slug: z.string(), buildId: z.string(), commentId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: commentSchema } },
      description: "Comment resolved",
    },
    ...notFound,
  },
});

const reopenCommentRoute = createRoute({
  method: "post",
  tags: ["Review"],
  summary: "Reopen a resolved comment",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments/{commentId}/reopen",
  request: { params: z.object({ slug: z.string(), buildId: z.string(), commentId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: commentSchema } },
      description: "Comment reopened",
    },
    ...notFound,
  },
});

/** A comment as the API returns it: the stored mentions decoded to `{ userId, handle }` entries. */
function commentJson(comment: Comment): Omit<Comment, "mentions"> & { mentions: CommentMention[] } {
  return { ...comment, mentions: CommentModel.mentionsOf(comment) };
}

/** Register the build comment list, create, resolve and reopen endpoints. */
export function registerComments(app: ShelfRouter): void {
  app.openapi(listCommentsRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    const build = await buildForProject(project.id, buildId);
    const comments = await new CommentModel(getStore().db).listByBuild(build.id);
    return c.json(comments.map((comment) => commentJson(comment)));
  });

  app.openapi(createCommentRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const comment = await createComment(project, build.id, c.req.valid("json"));
    hxRefresh(c);
    flashHx(c, "Comment added");
    return c.json(commentJson(comment), 201);
  });

  app.openapi(resolveCommentRoute, async (c) => {
    const { slug, buildId, commentId } = c.req.valid("param");
    const { build } = await resolveTriager(c, slug, buildId);
    const comment = await resolveBuildComment(build.id, commentId);
    hxRefresh(c);
    flashHx(c, "Comment resolved");
    return c.json(commentJson(comment));
  });

  app.openapi(reopenCommentRoute, async (c) => {
    const { slug, buildId, commentId } = c.req.valid("param");
    const { build } = await resolveTriager(c, slug, buildId);
    const comment = await reopenBuildComment(build.id, commentId);
    hxRefresh(c);
    flashHx(c, "Comment reopened");
    return c.json(commentJson(comment));
  });
}

/** A comment of `buildId`; 404 for a comment of another build. */
async function commentOfBuild(buildId: string, commentId: string): Promise<Comment> {
  const found = (await new CommentModel(getStore().db).listByBuild(buildId)).find(
    (item) => item.id === commentId,
  );
  return found ?? throwNotFound("Comment not found");
}

/** Mark a comment of `buildId` resolved by the current user; 404 for a comment of another build. */
export async function resolveBuildComment(buildId: string, commentId: string): Promise<Comment> {
  await commentOfBuild(buildId, commentId);
  return await new CommentModel(getStore().db).resolve(commentId, getStore().user?.id ?? null);
}

/** Open a resolved comment of `buildId` again; 404 for a comment of another build. */
export async function reopenBuildComment(buildId: string, commentId: string): Promise<Comment> {
  await commentOfBuild(buildId, commentId);
  return await new CommentModel(getStore().db).reopen(commentId);
}

/** A comment anchors to the build, a story or a snapshot (ADR 0013, decision 2), never two. */
function assertOneAnchor(body: {
  snapshotId?: string | undefined;
  storyId?: string | undefined;
}): void {
  if (body.snapshotId !== undefined && body.storyId !== undefined) {
    throw new HTTPException(400, {
      message: "A comment anchors to the build, a story or a snapshot, not several",
    });
  }
}

/** Where a comment is anchored: its snapshot, else its story, else the build. */
export function commentScope(comment: Comment): "build" | "story" | "snapshot" {
  if (comment.snapshotId !== null) {
    return "snapshot";
  }
  return comment.storyId === null ? "build" : "story";
}

/**
 * Every comment raises one `comment:created` (ADR 0013, decision 10), anchored by `scope`.
 * `review:comment` is a subscription alias for the build and story scopes, not a second event.
 * `eventId` is the comment id, so a retried delivery carries the same id. Members who get the
 * comment as a mention (`skipUsers`) are left out of its subscriber notifications: one message.
 */
async function announceComment(
  project: Project,
  buildId: string,
  comment: Comment,
  skipUsers: ReadonlySet<string>,
): Promise<void> {
  const data = {
    eventId: comment.id,
    scope: commentScope(comment),
    buildId,
    commentId: comment.id,
    snapshotId: comment.snapshotId,
    storyId: comment.storyId,
    kind: comment.kind,
    body: comment.body.slice(0, 500),
  };
  await announceReview(project, REVIEW_EVENTS.commentCreated, data, buildId, { skipUsers });
}

/**
 * The project members `text` mentions (#463), by `@email-local-part` or `@display name`. Only this
 * project's members can resolve, so a mention never reveals who is in another project. Skips the
 * member lookup entirely for the common comment with no `@`.
 */
async function mentionsIn(project: Project, text: string): Promise<FoundMention[]> {
  if (!text.includes("@")) {
    return [];
  }
  const people = await mentionCandidates(getStore().db, project.id);
  return resolveMentions(
    text,
    people.map((person) => person.candidate),
  );
}

/** One `comment:mentioned` per mentioned member; a failure to notify never fails the comment. */
async function announceMentions(
  project: Project,
  comment: Comment,
  mentions: readonly FoundMention[],
): Promise<void> {
  const user = getStore().user;
  const data = mentionData(comment, commentScope(comment), user ? displayNameOf(user) : "Someone");
  await Promise.all(
    mentions.map(async (mention) => {
      await announceMention(project, mention.userId, data, comment.buildId).catch(
        (error: unknown) => {
          getStore().logger.warn(
            { err: error, commentId: comment.id },
            "mention notification failed",
          );
        },
      );
    }),
  );
}

export async function createComment(
  project: Project,
  buildId: string,
  body: CommentCreateInput,
): Promise<Comment> {
  assertOneAnchor(body);
  const userId = getStore().user?.id ?? null;
  // Resolved here, never taken from the request: a client cannot name who gets notified.
  const mentions = await mentionsIn(project, body.body);
  const comment = await new CommentModel(getStore().db).create(project.id, buildId, userId, {
    ...body,
    mentions,
  });
  // Mentioning yourself is highlighted but never notifies you.
  const notify = mentions.filter((mention) => mention.userId !== userId);
  await announceComment(
    project,
    buildId,
    comment,
    new Set(notify.map((mention) => mention.userId)),
  );
  await announceMentions(project, comment, notify);
  return comment;
}
