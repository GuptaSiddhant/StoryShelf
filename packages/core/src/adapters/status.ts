import type { Logger } from "pino";
import type { z } from "zod";

/** Status of a git provider check. */
export type CheckStatus = "pending" | "success" | "failure";

/** Runtime contract — reports build status to a git provider. */
export interface StatusAdapter {
  /** Set the status of a git provider check for a commit. */
  setStatus(context: string, gitSha: string, status: CheckStatus, url: string): Promise<void>;
}

/** Factory descriptor — how a provider is discovered, validated, and instantiated. */
export interface StatusProvider {
  /** Unique key, stored as `project_status_configs.provider`. */
  readonly provider: string;
  /** Human label for UI picker. */
  readonly name: string;
  /** Optional description for UI. */
  readonly description?: string;
  /** Package version (from package.json). */
  readonly version: string;
  /** Optional logo URL or icon name. */
  readonly logo?: string;
  /** Zod schema that validates `config` JSON for this provider. */
  readonly configSchema: z.ZodType;
  /** Create a runtime adapter from decrypted config + token. */
  create(opts: { config: unknown; token: string; logger?: Logger }): StatusAdapter;
}
