/** Shared `setState` routing for providers that write commit statuses and review comments. */
import type {
  NotifierState,
  StateNotifierAdapter,
  StateNotifierMetadata,
} from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { describeState } from "./describe.ts";

/** What a host-specific writer does for each target kind. */
export interface StateWriter {
  /** Set the commit status `context` on `sha`. */
  status(input: {
    sha: string;
    context: string;
    state: NotifierState;
    description: string;
    url: string;
  }): Promise<void>;
  /** Create or update the single review comment of the build keyed by `url`. */
  comment(input: { sha: string; url: string; markdown: string }): Promise<unknown>;
}

/** Build the runtime adapter that routes a target kind to the writer. */
export function createStateAdapter(
  metadata: StateNotifierMetadata,
  writer: StateWriter,
  logger?: Logger,
): StateNotifierAdapter {
  return {
    metadata,
    async setState({ target, state, url }): Promise<void> {
      if (target.kind === "status") {
        await writer.status({
          sha: target.sha,
          context: target.context,
          state,
          description: target.description ?? describeState(state),
          url,
        });
        return;
      }
      logger?.debug({ sha: target.sha }, "upserting review comment");
      await writer.comment({ sha: target.sha, url, markdown: target.markdown });
    },
  };
}

/** The channel's token, or an error naming the provider when the channel has none. */
export function requireToken(secret: string | undefined, provider: string): string {
  if (!secret) {
    throw new Error(`${provider} channel needs a token`);
  }
  return secret;
}
