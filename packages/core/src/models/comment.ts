/** Build and snapshot review comments. */
import { eq } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Comment, CommentMention } from "../schema/comment.ts";
import type { CommentKind } from "../types.ts";
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

  /** One comment by id, or null. */
  async get(id: string): Promise<Comment | null> {
    return (await this.db.get(this.tables.comments, id)) as unknown as Comment | null;
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
      mentions:
        input.mentions === undefined || input.mentions.length === 0
          ? null
          : JSON.stringify(input.mentions),
      resolved: false,
      kind: input.kind ?? "comment",
      resolvedAt: null,
      resolvedBy: null,
      createdAt: now,
      updatedAt: now,
    })) as unknown as Comment;
  }

  /**
   * The mentions stored on a comment. Tolerant of anything else in the column (a hand-edited row,
   * an older shape): such entries are dropped, never thrown on.
   */
  static mentionsOf(comment: Pick<Comment, "mentions">): CommentMention[] {
    if (!comment.mentions) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(comment.mentions);
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is CommentMention => isMention(entry))
        : [];
    } catch {
      return [];
    }
  }

  /** Mark a comment resolved by `userId` (null on an instance without authentication). */
  async resolve(id: string, userId: string | null = null): Promise<Comment> {
    const now = new Date().toISOString();
    return (await this.db.update(this.tables.comments, id, {
      resolved: true,
      resolvedAt: now,
      resolvedBy: userId,
      updatedAt: now,
    })) as unknown as Comment;
  }

  /** Open a resolved comment again; who resolved it and when are cleared. */
  async reopen(id: string): Promise<Comment> {
    return (await this.db.update(this.tables.comments, id, {
      resolved: false,
      resolvedAt: null,
      resolvedBy: null,
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
  /** Members the body mentions, resolved by the caller; stored as ids (see `Comment.mentions`). */
  mentions?: readonly CommentMention[];
  /** `change_request` asks the build's author to address it; default `comment`. */
  kind?: CommentKind;
}

function isMention(value: unknown): value is CommentMention {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { userId?: unknown }).userId === "string" &&
    typeof (value as { handle?: unknown }).handle === "string"
  );
}
