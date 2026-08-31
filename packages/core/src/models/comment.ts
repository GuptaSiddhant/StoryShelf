import { eq } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import { comments, projects, type Comment } from "../schema.ts";
import { ulid } from "../utils/ulid.ts";

export interface CommentCreateInput {
  body: string;
  snapshotId?: string;
  parentId?: string;
}

/** Data operations for review comments. */
export class CommentModel {
  /**
   * @param db - Database adapter.
   */
  constructor(private readonly db: DatabaseAdapter) {}

  /** List all comments belonging to a build. */
  async listByBuild(buildId: string): Promise<Comment[]> {
    return await this.db.list(comments, { where: eq(comments.buildId, buildId) });
  }

  /**
   * Create a comment on a build or snapshot.
   *
   * @param projectId - Project ID.
   * @param buildId - Build ID.
   * @param userId - Authoring user ID.
   * @param input - Comment creation input.
   * @returns The created comment.
   */
  async create(projectId: string, buildId: string, userId: string, input: CommentCreateInput): Promise<Comment> {
    const now = new Date().toISOString();
    const project = await this.db.get(projects, projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return await this.db.insert(comments, {
      id: ulid(),
      projectId,
      buildId,
      snapshotId: input.snapshotId,
      userId,
      body: input.body,
      parentId: input.parentId,
      resolved: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Mark a comment as resolved. */
  async resolve(id: string): Promise<Comment> {
    return await this.db.update(comments, id, { resolved: true, updatedAt: new Date().toISOString() });
  }
}

export type { Comment };
