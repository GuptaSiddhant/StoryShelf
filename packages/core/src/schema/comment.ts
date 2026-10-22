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
  createdAt: string;
  updatedAt: string;
}
