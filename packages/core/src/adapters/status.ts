import type { Logger } from "pino";

import type { GitAdapterMetadata } from "./metadata.ts";

/** Status of a git provider check. */
export type CheckStatus = "pending" | "success" | "failure";

/** Single git adapter — descriptor + runtime. Template exposes metadata.schema; configured instance exposes setStatus. */
export interface GitAdapter {
  /** Adapter identity (name, version, description, kind="github", logo, schema). */
  readonly metadata: GitAdapterMetadata;

  /** Bind per-project config + decrypted token to a status-capable instance. */
  withConfig(opts: { config: unknown; token: string; logger?: Logger }): GitAdapter;

  /** Set the status of a git provider check for a commit. */
  setStatus(context: string, gitSha: string, status: CheckStatus, url: string): Promise<void>;
}
