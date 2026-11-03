/** A project member a comment mentions: their id, and the `@handle` text as typed. */
export interface CommentMention {
  userId: string;
  handle: string;
}

/** A comment row. */
export interface Comment {
  id: string;
  projectId: string;
  buildId: string;
  snapshotId: string | null;
  /** Storybook story id of a story-anchored comment (ADR 0013, decision 2); null otherwise. */
  storyId: string | null;
  userId: string | null;
  body: string;
  parentId: string | null;
  /**
   * JSON array of `{ userId, handle }` for the project members the body mentions with `@handle`
   * (resolved when the comment was posted; null when none). Ids, not names, so a rename keeps the
   * mention; `handle` is the text as typed, to find it again in the body.
   */
  mentions?: string | null;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}
