import type { StateNotifierProvider } from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { z } from "zod";
import { packageVersion } from "./version.ts";

/** Validation schema for the log provider config (accepts anything). */
export const logConfigSchema = z.object({}).loose();

/** Log-only git provider for tests, dev, and unconfigured servers (`git-log`). */
export const gitLogNotifier: StateNotifierProvider = {
  metadata: getMetadata(),
  create(opts: { config: unknown; secret?: string; logger?: Logger }) {
    logConfigSchema.parse(opts.config);
    const logger = opts.logger?.child({ component: "notify-git-log" }) ?? opts.logger;
    return {
      metadata: getMetadata(),
      // oxlint-disable-next-line eslint/require-await -- setState is async by contract
      async setState(input): Promise<void> {
        logger?.info(
          { channelId: input.channel.id, target: input.target, state: input.state },
          "git state (log)",
        );
      },
    };
  },
};

/** Describe the log provider (name, version, config schema). */
export function getMetadata(): StateNotifierProvider["metadata"] {
  return {
    name: "Git log",
    version: packageVersion(),
    description: "Git statuses and comments to the server log (tests and dev)",
    kind: "git-log",
    category: "notifier",
    delivery: "state",
    schema: logConfigSchema,
  };
}
