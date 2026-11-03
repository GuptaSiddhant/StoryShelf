/**
 * Comment mentions at the app layer (#463): who a comment can mention (the project's members),
 * how they are named, and what a `comment:mentioned` notification carries. The parsing itself is
 * pure and lives in core (`resolveMentions`).
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { MemberModel, UserModel } from "@storyshelf/core/models";
import type { Comment, CommentMention, User } from "@storyshelf/core/schema";
import { resolveMentions, type MentionCandidate } from "@storyshelf/core/utils";
import { getStore } from "./store.ts";

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

/** What the text ends with after a mention-starting `@`: where it starts, and what was typed. */
export interface TypedMention {
  /** Index of the `@`. */
  start: number;
  /** The text after it (may be empty, may hold spaces: display names do). */
  fragment: string;
}

const LONGEST_FRAGMENT = 40;

/**
 * The `@fragment` the text ends with: the last `@` that starts a word (not the one in an email
 * address), followed by at most a short stretch of one line. The suggest form posts the whole
 * text and no caret position, so the end of the text is where the member is typing.
 */
export function typedMention(text: string): TypedMention | undefined {
  const start = text.lastIndexOf("@");
  if (start === -1) {
    return undefined;
  }
  const before = text[start - 1];
  const fragment = text.slice(start + 1);
  const startsWord = before === undefined || !/[\p{L}\p{N}_]/u.test(before);
  return startsWord && fragment.length <= LONGEST_FRAGMENT && !fragment.includes("\n")
    ? { start, fragment }
    : undefined;
}

/** A member offered while typing: who they are, and the handle that will resolve to them. */
export interface MentionSuggestion {
  userId: string;
  handle: string;
  name: string;
}

/** How many members one suggestion list offers. */
export const MAX_SUGGESTIONS = 5;

/**
 * The members whose handle or name starts with what was typed, each with a handle that resolves
 * to them alone (a handle two members share would be plain text once posted, so it is never
 * offered). The list is only ever built from the project's own members.
 */
export function suggestMembers(
  people: readonly { candidate: MentionCandidate; user: User }[],
  fragment: string,
): MentionSuggestion[] {
  const typed = fragment.trim().toLowerCase();
  const candidates = people.map((person) => person.candidate);
  const offered: MentionSuggestion[] = [];
  for (const { candidate, user } of people.toSorted((a, b) =>
    displayNameOf(a.user).localeCompare(displayNameOf(b.user)),
  )) {
    const handle = candidate.handles.find(
      (option) =>
        option.toLowerCase().startsWith(typed) &&
        resolveMentions(`@${option} `, candidates).some((found) => found.userId === user.id),
    );
    if (handle !== undefined) {
      offered.push({ userId: user.id, handle, name: displayNameOf(user) });
    }
  }
  return offered.slice(0, MAX_SUGGESTIONS);
}

/** The text with what was being typed replaced by the chosen handle and a space after it. */
export function completeMention(text: string, typed: TypedMention, handle: string): string {
  return `${text.slice(0, typed.start)}@${handle} `;
}

/**
 * The names to show for the members a comment mentions: their current display names, so a rename
 * is followed and the stored mention (an id) keeps rendering. A member who no longer exists has
 * no entry; the caller falls back to the handle as typed.
 */
export async function mentionNamesOf(
  mentions: readonly CommentMention[],
): Promise<Map<string, string>> {
  const users = new UserModel(getStore().db);
  const found = await Promise.all(mentions.map(async (mention) => await users.get(mention.userId)));
  return new Map(found.flatMap((user) => (user === null ? [] : [[user.id, displayNameOf(user)]])));
}
