/** Build and snapshot review comments. */
import { eq } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { comments, projects } from "../schema-tables.ts";
import type { Comment } from "../schema.ts";
import { ulid } from "../utils/ulid.ts";

/** Input for creating a review comment. */
export interface CommentCreateInput {
  body: string;
  snapshotId?: string;
  parentId?: string;
}

/** Data operations for review comments. */
export class CommentModel {
  constructor(private readonly db: DatabaseAdapter) {}

  async listByBuild(buildId: string): Promise<Comment[]> {
    return await this.db.list(comments, { where: eq(comments.buildId, buildId) });
  }

  async create(
    projectId: string,
    buildId: string,
    userId: string,
    input: CommentCreateInput,
  ): Promise<Comment> {
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

  async resolve(id: string): Promise<Comment> {
    return await this.db.update(comments, id, {
      resolved: true,
      updatedAt: new Date().toISOString(),
    });
  }
}

export type { Comment };
