/**
 * Comment mentions at the app layer (#463): who a comment can mention (the project's members),
 * how they are named, and what a `comment:mentioned` notification carries. The parsing itself is
 * pure and lives in core (`resolveMentions`).
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { MemberModel, UserModel } from "@storyshelf/core/models";
import type { Comment, User } from "@storyshelf/core/schema";
import type { MentionCandidate } from "@storyshelf/core/utils";

/** How a member is shown: the name they set, else the one their sign-in gave. */
export function displayNameOf(user: Pick<User, "name" | "displayNameOverride">): string {
  return user.displayNameOverride ?? user.name;
}

/** The handles that name a member: the part of their email before the `@`, and their name. */
export function handlesOf(user: Pick<User, "email" | "name" | "displayNameOverride">): string[] {
  const local = user.email.split("@")[0] ?? "";
  return [local, displayNameOf(user)].filter((handle) => handle.trim() !== "");
}

/** The members of a project a comment can mention; disabled accounts are not offered. */
export async function mentionCandidates(
  db: DatabaseAdapter,
  projectId: string,
): Promise<{ candidate: MentionCandidate; user: User }[]> {
  const members = await new MemberModel(db).list(projectId);
  const users = new UserModel(db);
  const found = await Promise.all(members.map(async (member) => await users.get(member.userId)));
  return found.flatMap((user) =>
    user === null || user.disabled === true
      ? []
      : [{ candidate: { userId: user.id, handles: handlesOf(user) }, user }],
  );
}

/**
 * The payload of `comment:mentioned`. It carries the same comment id as `comment:created`;
 * `authorName` and `message` are the fields the verbose notification styles already print.
 */
export function mentionData(
  comment: Comment,
  scope: "build" | "story" | "snapshot",
  authorName: string,
): Record<string, unknown> {
  return {
    eventId: comment.id,
    scope,
    buildId: comment.buildId,
    commentId: comment.id,
    snapshotId: comment.snapshotId,
    storyId: comment.storyId,
    authorName,
    message: comment.body.slice(0, 500),
  };
}
