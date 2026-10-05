import type { Logger } from "../../logger.ts";
import { formatNotification, formatSystemNotification } from "./format.ts";
import type { NotifierProvider } from "./provider.ts";
import type {
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
}

/** Check an event against a channel's allowlist (empty = all). */
function subscribed(channel: NotificationChannel, event: string): boolean {
  if (!channel.enabled) {
    return false;
  }
  return channel.events.length === 0 || channel.events.includes(event);
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
  const sender = provider.create({ config: channel.config, secret: channel.secret });
  await sender.send({ channel, formatted });
}

/**
 * Deliver a project event to every subscribed channel.
 * Inline best-effort: `Promise.allSettled`, failures logged and swallowed.
 */
export async function emitNotifications(
  event: NotificationEvent,
  options: EmitNotificationsOptions = {},
): Promise<void> {
  const targets = (options.channels ?? []).filter((channel) => subscribed(channel, event.event));
  if (targets.length === 0) {
    return;
  }
  await Promise.allSettled(
    targets.map(async (channel) => {
      try {
        await deliver(options.notifiers, channel, formatNotification(event, options.brand));
      } catch (error) {
        options.logger?.warn({ err: error, channelId: channel.id }, "notification failed");
      }
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
    (channel) => channel.projectId === null && subscribed(channel, event.event),
  );
  if (targets.length === 0) {
    return;
  }
  await Promise.allSettled(
    targets.map(async (channel) => {
      try {
        await deliver(options.notifiers, channel, formatSystemNotification(event, options.brand));
      } catch (error) {
        options.logger?.warn({ err: error, channelId: channel.id }, "system notification failed");
      }
    }),
  );
}
