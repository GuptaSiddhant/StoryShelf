import type { ShelfConfig } from "@storyshelf/core/config";
/**
 * Notifications need a public origin (ADR 0014, decision 11): every message carries a link and
 * every git status targets one, so while the resolver (ADR 0007, decision 6) finds no origin
 * nothing is sent. Pausing is not a failure: no channel is marked as errored, and the System page
 * and the notification settings say what to set.
 */
import type { Logger } from "@storyshelf/core/logger";
import type { PublicOriginResolver } from "@storyshelf/core/models";
import { getStore, type Store } from "./store.ts";

/** What the System page and the notification settings tell the viewer. */
export const NOTIFICATIONS_PAUSED_TEXT =
  "Notifications are paused until a public URL is set; set PUBLIC_BASE_URL or confirm the detected origin.";

/** What a pause check reads. */
interface OriginDeps {
  config: Pick<ShelfConfig, "publicBaseUrl">;
  /** The resolver; absent (hand-built stores) means `config.publicBaseUrl` only. */
  publicOrigin?: Pick<PublicOriginResolver, "url"> | undefined;
}

/** The origin notifications link to, or `undefined` while none is resolved. */
export async function notificationOrigin(deps: OriginDeps): Promise<string | undefined> {
  const origin = deps.publicOrigin ? await deps.publicOrigin.url() : deps.config.publicBaseUrl;
  const trimmed = origin?.trim().replace(/\/+$/u, "");
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/** Whether the current instance sends no notifications for want of a public origin. */
export async function notificationsPaused(store: Store = getStore()): Promise<boolean> {
  return (await notificationOrigin(store)) === undefined;
}

/** Loggers that already said so; cleared when an origin resolves, so a later pause logs again. */
const warned = new WeakSet<object>();

/** Log (once per pause, per logger) that a notification was skipped. */
export function warnPaused(logger: Logger, event: string): void {
  if (!warned.has(logger)) {
    warned.add(logger);
    logger.warn({ event }, `${NOTIFICATIONS_PAUSED_TEXT} Skipping notifications.`);
  }
}

/** Forget a logged pause: an origin resolved. */
export function clearPaused(logger: Logger): void {
  warned.delete(logger);
}
