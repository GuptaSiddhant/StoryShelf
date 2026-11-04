/** Writing a build's desired states to one `state` channel (git hosts); see `build-state.ts` for what they are. */
import type { Logger } from "../../logger.ts";
import type { BuildStateSet } from "./build-state.ts";
import type { StateNotifierProvider } from "./provider.ts";
import type { NotificationChannel } from "./types.ts";

/** Default status-name prefix of a git channel (`<prefix>/testing`). */
export const DEFAULT_STATUS_PREFIX = "storyshelf";

/** The channel's status-name prefix: its `prefix` config, else {@link DEFAULT_STATUS_PREFIX}. */
export function channelPrefix(channel: NotificationChannel): string {
  const prefix = channel.config["prefix"];
  return typeof prefix === "string" && prefix.length > 0 ? prefix : DEFAULT_STATUS_PREFIX;
}

/**
 * Make the channel's host show `states` for the commit `sha`: every status, then the comment.
 * Each write is idempotent (latest call wins). A failed status write throws so the caller can
 * retry; a failed comment write is logged and never fails the statuses.
 */
export async function writeBuildState(
  provider: StateNotifierProvider,
  channel: NotificationChannel,
  write: {
    sha: string;
    states: BuildStateSet;
    logger?: Logger | undefined;
    /** Checked before the comment is sent, after the statuses settled; an aborted one throws. */
    signal?: AbortSignal | undefined;
  },
): Promise<void> {
  const { sha, states, logger, signal } = write;
  const adapter = provider.create({ config: channel.config, secret: channel.secret, logger });
  const results = await Promise.allSettled(
    states.statuses.map(async (status) => {
      await adapter.setState({
        channel,
        target: {
          kind: "status",
          sha,
          context: status.context,
          description: status.description,
          ...(status.informational === true ? { informational: true } : {}),
          ...(status.progress === undefined ? {} : { progress: status.progress }),
          ...(status.annotations === undefined ? {} : { annotations: status.annotations }),
          ...(status.omitted === undefined ? {} : { omitted: status.omitted }),
        },
        state: status.state,
        url: status.url,
        logger,
      });
    }),
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason;
  }
  if (states.comment !== null) {
    signal?.throwIfAborted();
    await upsertComment({ adapter, channel, sha, comment: states.comment, logger });
  }
}

/** The PR comment: a failed write is logged and never fails the statuses written before it. */
async function upsertComment(input: {
  adapter: ReturnType<StateNotifierProvider["create"]>;
  channel: NotificationChannel;
  sha: string;
  comment: NonNullable<BuildStateSet["comment"]>;
  logger: Logger | undefined;
}): Promise<void> {
  const { adapter, channel, sha, comment, logger } = input;
  await adapter
    .setState({
      channel,
      target: { kind: "comment", sha, markdown: comment.markdown },
      state: comment.state,
      url: comment.url,
      logger,
    })
    .catch((error: unknown) => {
      logger?.warn({ err: error, channelId: channel.id }, "failed to upsert comment");
    });
}
