import { eq } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import { comments, type Comment } from "../schema.ts";
import { ulid } from "../utils/ulid.ts";

export interface CommentCreateInput {
  body: string;
  snapshotId?: string;
  parentId?: string;
}

export class CommentModel {
  constructor(private readonly db: DatabaseAdapter) {}

  async listByBuild(buildId: string): Promise<Comment[]> {
    return await this.db.list(comments, { where: eq(comments.buildId, buildId) });
  }

  async create(projectId: string, buildId: string, userId: string, input: CommentCreateInput): Promise<Comment> {
    const now = new Date().toISOString();
    return await this.db.insert(comments, {
      id: ulid(),
      projectId,
      buildId,
      snapshotId: input.snapshotId,
      userId,
      body: input.body,
      parentId: input.parentId,
      createdAt: now,
      updatedAt: now,
    });
  }

  async resolve(id: string): Promise<Comment> {
    return await this.db.update(comments, id, { resolved: true, updatedAt: new Date().toISOString() });
  }
}

export type { Comment };
