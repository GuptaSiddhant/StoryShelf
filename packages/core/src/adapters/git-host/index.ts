/**
 * Git-host adapter interface: commit statuses and review comments for merge gates.
 */
import type { Logger } from "pino";

import type { GitAdapterMetadata } from "../metadata.ts";

/** Status of a git-host provider check. */
export type CheckStatus = "pending" | "success" | "failure";

/** Descriptor — registered at startup, validates per-project config. */
export interface GitHostProvider {
  /** Adapter identity (name, version, description, kind="github", logo, schema). */
  readonly metadata: GitAdapterMetadata;

  /** Create a configured instance bound to a project config + decrypted token. */
  create(opts: { config: unknown; token: string; logger?: Logger }): GitHostAdapter;
}

/** Runtime — bound to a project config + token, posts statuses/comments. */
export interface GitHostAdapter {
  /** Adapter identity. */
  readonly metadata: GitAdapterMetadata;

  /** Set the status of a commit. */
  setStatus(opts: { context: string; gitSha: string; status: CheckStatus; url: string }): Promise<void>;

  /** Whether the branch/sha is already merged — gate to skip capture. */
  isMerged?(opts: { sha: string; branch: string }): Promise<boolean>;

  /** Create or update a single PR comment per build (idempotent via url marker). */
  upsertComment?(opts: { prNumber?: number; sha: string; url: string; status: CheckStatus; markdown: string }): Promise<string>;
}
