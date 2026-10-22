/** Shared `setState` routing for providers that write commit statuses and review comments. */
import type {
  NotifierState,
  StateAnnotation,
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
    /** Absent while no public origin is known: the status has no link. */
    url?: string | undefined;
    /** For a `pending` state: not started (`queued`) or under way. */
    progress?: "queued" | "running" | undefined;
    /** Never a gate: a host with a neutral outcome shows a failure as neutral. */
    informational?: boolean | undefined;
    annotations?: StateAnnotation[] | undefined;
    /** Changed snapshots left out of `annotations`. */
    omitted?: number | undefined;
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
          progress: target.progress,
          informational: target.informational,
          annotations: target.annotations,
          omitted: target.omitted,
        });
        return;
      }
      if (url === undefined) {
        // The comment is keyed by the build's link; without a public origin there is none.
        return;
      }
      logger?.debug({ sha: target.sha }, "upserting review comment");
      await writer.comment({ sha: target.sha, url, markdown: target.markdown });
    },
  };
}

/** The channel's secret (token or private key), or an error naming the provider when the channel has none. */
export function requireToken(
  secret: string | undefined,
  provider: string,
  what = "a token",
): string {
  if (!secret) {
    throw new Error(`${provider} channel needs ${what}`);
  }
  return secret;
}
