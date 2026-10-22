/** Build and snapshot review comments. */
import { eq } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Comment } from "../schema/comment.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

/** Tables required by {@link CommentModel}. */
export interface CommentTables {
  comments: Table;
  projects: Table;
}

/** Data operations for review comments. */
export class CommentModel {
  private readonly tables: CommentTables;
  private readonly db: DatabaseAdapter;

  constructor(db: DatabaseAdapter, tables?: CommentTables) {
    this.db = db;
    this.tables = tables ?? {
      comments: db.tables.comments,
      projects: db.tables.projects,
    };
  }

  async listByBuild(buildId: string): Promise<Comment[]> {
    return (await this.db.list(this.tables.comments, {
      where: eq(col(this.tables.comments, "buildId"), buildId),
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
    if (input.snapshotId !== undefined && input.storyId !== undefined) {
      throw new Error("A comment anchors to a build, a story or a snapshot, not several");
    }
    return (await this.db.insert(this.tables.comments, {
      id: ulid(),
      projectId,
      buildId,
      snapshotId: input.snapshotId ?? null,
      storyId: input.storyId ?? null,
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
  /** Anchor to a snapshot (builds with snapshots). */
  snapshotId?: string;
  /** Anchor to a story of the build's catalog; not together with `snapshotId` (ADR 0013, decision 2). */
  storyId?: string;
  parentId?: string;
}
