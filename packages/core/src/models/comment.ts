/** Build and snapshot review comments. */
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { Comment } from "../schema/comment.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link CommentModel}. */
export interface CommentTables {
  comments: Table;
  projects: Table;
}

/** Data operations for review comments. */
export class CommentModel {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly tables: CommentTables,
  ) {}

  async listByBuild(buildId: string): Promise<Comment[]> {
    return (await this.db.list(this.tables.comments, {
      where: eq(getTableColumns(this.tables.comments)["buildId"] as unknown as SQLWrapper, buildId),
    })) as unknown as Comment[];
  }

  async create(
    projectId: string,
    buildId: string,
    userId: string | null,
    input: CommentCreateInput,
  ): Promise<Comment> {
    const now = new Date().toISOString();
    const project = (await this.db.get(this.tables.projects, projectId)) as unknown as {
      id: string;
    } | null;
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return (await this.db.insert(this.tables.comments, {
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
    })) as unknown as Comment;
  }

  async resolve(id: string): Promise<Comment> {
    return (await this.db.update(this.tables.comments, id, {
      resolved: true,
      updatedAt: new Date().toISOString(),
    })) as unknown as Comment;
  }
}

/** Input for creating a review comment. */
export interface CommentCreateInput {
  body: string;
  snapshotId?: string;
  parentId?: string;
}
