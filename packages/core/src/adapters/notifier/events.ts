import type { Logger } from "../../logger.ts";
import { sanitizeErrorText } from "../../utils/redact.ts";
import { formatNotification, formatSystemNotification } from "./format.ts";
import { isStateProvider, type NotifierProvider } from "./provider.ts";
import type {
  ChannelOutcome,
  NotificationBrand,
  NotificationChannel,
  NotificationEvent,
  SystemNotification,
} from "./types.ts";

/** Options for project-event fan-out (inline best-effort, non-fatal). */
export interface EmitNotificationsOptions {
  notifiers?: NotifierProvider[];
  channels?: NotificationChannel[];
  brand?: NotificationBrand;
  logger?: Logger;
  /** Called once per attempted channel so the host can record or clear its last error. */
  onOutcome?: (outcome: ChannelOutcome) => Promise<void> | void;
}

/** Check an event against a channel's allowlist (empty = all). */
function subscribed(channel: NotificationChannel, event: string): boolean {
  if (!channel.enabled) {
    return false;
  }
  return channel.events.length === 0 || channel.events.includes(event);
}

/** `state` channels (git hosts) follow build state, never the message fan-out. */
function isMessageChannel(
  notifiers: NotifierProvider[] | undefined,
  channel: NotificationChannel,
): boolean {
  const provider = providerFor(notifiers, channel.provider);
  return provider === undefined || !isStateProvider(provider);
}

/** Resolve a provider for a channel kind, or undefined when unwired. */
function providerFor(
  notifiers: NotifierProvider[] | undefined,
  kind: string,
): NotifierProvider | undefined {
  return notifiers?.find((candidate) => candidate.metadata.kind === kind);
}

/** Send one formatted event through a channel's provider (throws on failure). */
async function deliver(
  notifiers: NotifierProvider[] | undefined,
  channel: NotificationChannel,
  formatted: ReturnType<typeof formatNotification>,
): Promise<void> {
  const provider = providerFor(notifiers, channel.provider);
  if (!provider) {
    throw new Error(`notifier missing: ${channel.provider}`);
  }
  if (isStateProvider(provider)) {
    throw new Error(`notifier ${channel.provider} delivers state, not messages`);
  }
  const sender = provider.create({ config: channel.config, secret: channel.secret });
  await sender.send({ channel, formatted });
}

/** Deliver to one channel, report the outcome and swallow the failure (logged). */
async function deliverReported(
  options: EmitNotificationsOptions,
  channel: NotificationChannel,
  formatted: ReturnType<typeof formatNotification>,
  failure: string,
): Promise<void> {
  let problem: string | undefined;
  try {
    await deliver(options.notifiers, channel, formatted);
  } catch (error) {
    options.logger?.warn({ err: error, channelId: channel.id }, failure);
    problem = sanitizeErrorText(error instanceof Error ? error.message : String(error), 500);
  }
  await options.onOutcome?.({
    channelId: channel.id,
    ...(problem === undefined ? {} : { error: problem }),
  });
}

/**
 * Deliver a project event to every subscribed channel.
 * Inline best-effort: `Promise.allSettled`, failures logged and swallowed.
 */
export async function emitNotifications(
  event: NotificationEvent,
  options: EmitNotificationsOptions = {},
): Promise<void> {
  const targets = (options.channels ?? []).filter(
    (channel) => subscribed(channel, event.event) && isMessageChannel(options.notifiers, channel),
  );
  if (targets.length === 0) {
    return;
  }
  const formatted = formatNotification(event, options.brand);
  await Promise.allSettled(
    targets.map(async (channel) => {
      await deliverReported(options, channel, formatted, "notification failed");
    }),
  );
}

/**
 * Deliver a site-wide admin alert to project-less channels
 * (e.g. `sys:user-created`, `sys:capture-failed`, `sys:purge-completed`).
 */
export async function emitSystemNotification(
  event: SystemNotification,
  options: EmitNotificationsOptions = {},
): Promise<void> {
  const targets = (options.channels ?? []).filter(
    (channel) =>
      channel.projectId === null &&
      subscribed(channel, event.event) &&
      isMessageChannel(options.notifiers, channel),
  );
  if (targets.length === 0) {
    return;
  }
  const formatted = formatSystemNotification(event, options.brand);
  await Promise.allSettled(
    targets.map(async (channel) => {
      await deliverReported(options, channel, formatted, "system notification failed");
    }),
  );
}
