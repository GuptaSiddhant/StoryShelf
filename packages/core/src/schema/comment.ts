import type { CommentKind } from "../types.ts";

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
  resolved: boolean;
  /** `change_request` marks a comment the build's author is asked to address; default `comment`. */
  kind: CommentKind;
  /** When a change request was marked resolved; null while open or for a plain comment. */
  resolvedAt: string | null;
  /** User who resolved it (null for an anonymous instance or while open). */
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
