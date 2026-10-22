/** Build-state delivery: make every `state` channel (git hosts) show the build's current state. */
import type { Logger } from "../../logger.ts";
import { sanitizeErrorText } from "../../utils/redact.ts";
import { isStateProvider, type NotifierProvider, type StateNotifierProvider } from "./provider.ts";
import type { ChannelOutcome, NotificationChannel, NotifierState } from "./types.ts";

/** Default status-name prefix of a git channel (`<prefix>/testing`). */
export const DEFAULT_STATUS_PREFIX = "storyshelf";

/** Inputs for one build-state delivery. */
export interface BuildStateOptions {
  notifiers: NotifierProvider[];
  /** The project's channels; only enabled `state` channels take part. */
  channels: NotificationChannel[];
  /** Commit SHA the host should show the state on. */
  sha: string;
  state: NotifierState;
  /** Absolute URL of the build page. */
  url: string;
  /** Status name below the channel prefix, e.g. `testing`. */
  status: string;
  logger?: Logger;
  /** Called once per attempted channel so the host can record or clear its last error. */
  onOutcome?: (outcome: ChannelOutcome) => Promise<void> | void;
}

/** Status name on the host: the channel's prefix (default `storyshelf`) plus the status. */
export function statusContext(channel: NotificationChannel, status: string): string {
  const prefix = channel.config["prefix"];
  return `${typeof prefix === "string" && prefix.length > 0 ? prefix : DEFAULT_STATUS_PREFIX}/${status}`;
}

const COMMENT_TEXT: Record<NotifierState, string> = {
  pending: "Visual tests pending",
  success: "Visual tests passed",
  failure: "Visual changes detected",
};

/** Pull-request comment body for a build state. */
export function buildCommentMarkdown(state: NotifierState, url: string, context: string): string {
  return `${COMMENT_TEXT[state]} for \`${context}\` — [View build](${url})`;
}

/**
 * Make every enabled `state` channel show the build's state: a commit status and,
 * when the provider supports it, the pull-request comment. Best-effort per channel
 * (`Promise.allSettled`); failures are logged and reported through `onOutcome`.
 */
export async function emitBuildState(options: BuildStateOptions): Promise<void> {
  const targets = options.channels.flatMap((channel) => {
    const provider = options.notifiers.find(
      (candidate) => candidate.metadata.kind === channel.provider,
    );
    return channel.enabled && provider !== undefined && isStateProvider(provider)
      ? [{ channel, provider }]
      : [];
  });
  await Promise.allSettled(
    targets.map(async ({ channel, provider }) => {
      await deliverOne(options, channel, provider);
    }),
  );
}

/** Deliver to one channel and report the outcome; never throws. */
async function deliverOne(
  options: BuildStateOptions,
  channel: NotificationChannel,
  provider: StateNotifierProvider,
): Promise<void> {
  let failure: string | undefined;
  try {
    await writeState(options, channel, provider);
  } catch (error) {
    options.logger?.warn({ err: error, channelId: channel.id }, "state delivery failed");
    failure = sanitizeErrorText(error instanceof Error ? error.message : String(error), 500);
  }
  await options.onOutcome?.({
    channelId: channel.id,
    ...(failure === undefined ? {} : { error: failure }),
  });
}

/** Write the commit status, then the comment (a comment failure never fails the status). */
async function writeState(
  options: BuildStateOptions,
  channel: NotificationChannel,
  provider: StateNotifierProvider,
): Promise<void> {
  const { sha, state, url, logger } = options;
  const adapter = provider.create({ config: channel.config, secret: channel.secret, logger });
  const context = statusContext(channel, options.status);
  await adapter.setState({ channel, target: { kind: "status", sha, context }, state, url, logger });
  const markdown = buildCommentMarkdown(state, url, context);
  await adapter
    .setState({ channel, target: { kind: "comment", sha, markdown }, state, url, logger })
    .catch((error: unknown) => {
      logger?.warn({ err: error, channelId: channel.id }, "failed to upsert comment");
    });
}
