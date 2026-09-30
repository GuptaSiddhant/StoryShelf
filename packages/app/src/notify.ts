/**
 * Notification fan-out for routers: loads stored channels and subscriber
 * emails, then delegates to the wired notifier providers. Best-effort and
 * non-fatal — failures are logged inside the emitters, never thrown here.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import {
  emitNotifications,
  emitSystemNotification,
  type NotificationBrand,
  type NotificationChannel,
  type SystemEventName,
} from "@storyshelf/core/adapter/notifier";
import {
  NotificationChannelModel,
  NotificationSubscriptionModel,
  UserModel,
} from "@storyshelf/core/models";
import type { NotificationSubscriptionRow } from "@storyshelf/core/schema";
import type { NotificationChannelRow } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { getStore } from "./store.ts";

/** Review URL for a project page (absolute when `publicBaseUrl` is set). */
export function reviewUrlFor(slug: string, suffix: string): string | undefined {
  const base = getStore().config.publicBaseUrl?.replace(/\/+$/u, "");
  if (!base) {
    return undefined;
  }
  return `${base}/projects/${slug}${suffix}`;
}

/** Brand inputs from UI config plus server notification defaults. */
function brandFor(reviewUrl?: string): NotificationBrand {
  const { ui, config } = getStore();
  return {
    name: ui.name,
    logo: ui.logo,
    reviewUrl,
    fromEmail: config.notifications?.fromEmail,
    fromName: config.notifications?.fromName ?? ui.name,
    footerText: config.notifications?.footerText,
  };
}

/** Convert a stored row to a send-ready view (null when undecryptable). */
function toView(
  row: NotificationChannelRow,
  model: NotificationChannelModel,
): NotificationChannel | null {
  let secret: string | undefined;
  try {
    secret = row.secretEncrypted ? model.decryptSecret(row) : undefined;
  } catch {
    return null;
  }
  return {
    id: row.id,
    projectId: row.projectId,
    provider: row.provider,
    config: NotificationChannelModel.configOf(row),
    secret,
    events: NotificationChannelModel.eventsOf(row),
    enabled: row.enabled,
  };
}

/** Load stored channels as send-ready views (skips undecryptable secrets). */
async function loadChannels(projectId: string | null): Promise<NotificationChannel[]> {
  const { db, config } = getStore();
  const model = new NotificationChannelModel(db, undefined, config.secret);
  const rows = projectId === null ? await model.listSystem() : await model.list(projectId);
  return rows.filter((row) => row.enabled).flatMap((row) => toView(row, model) ?? []);
}

/** Subscriptions matching an event (enabled + allowlist). */
function matchingSubs(
  rows: NotificationSubscriptionRow[],
  event: string,
): NotificationSubscriptionRow[] {
  return rows.filter((row) => {
    if (!row.enabled) {
      return false;
    }
    const events = NotificationSubscriptionModel.eventsOf(row);
    return events.length === 0 || events.includes(event);
  });
}

/** Per-subscriber targets for one subscription (wired kinds only). */
async function targetsForSub(
  db: DatabaseAdapter,
  sub: NotificationSubscriptionRow,
  wired: ReadonlySet<string>,
): Promise<NotificationChannel[]> {
  const user = await new UserModel(db).get(sub.userId);
  if (!user || user.disabled) {
    return [];
  }
  const kinds = NotificationSubscriptionModel.viaOf(sub);
  const wants = kinds.length > 0 ? kinds : ["email"];
  return wants
    .filter((kind) => wired.has(kind))
    .map((kind) => ({
      id: `sub:${sub.id}:${kind}`,
      projectId: sub.projectId,
      provider: kind,
      config: { to: user.email },
      events: [],
      enabled: true,
    }));
}

/** Per-subscriber targets for an event (only kinds that are wired). */
async function subscriberTargets(
  projectId: string,
  event: string,
  wired: ReadonlySet<string>,
): Promise<NotificationChannel[]> {
  const { db } = getStore();
  const rows = await new NotificationSubscriptionModel(db).list(projectId);
  const nested = await Promise.all(
    matchingSubs(rows, event).map(async (sub) => await targetsForSub(db, sub, wired)),
  );
  return nested.flat();
}

/**
 * Fan out a project event to stored channels plus opted-in subscribers.
 * Runs alongside (never instead of) webhook delivery.
 */
export async function notifyProject(
  project: Pick<Project, "id" | "slug">,
  event: string,
  data: Record<string, unknown>,
  reviewSuffix?: string,
): Promise<void> {
  const { notifiers, logger } = getStore();
  if (notifiers.length === 0) {
    return;
  }
  const reviewUrl = reviewSuffix ? reviewUrlFor(project.slug, reviewSuffix) : undefined;
  const wired = new Set(notifiers.map((candidate) => candidate.metadata.kind));
  const channels = await loadChannels(project.id);
  const targets = await subscriberTargets(project.id, event, wired);
  await emitNotifications(
    { event, projectId: project.id, projectSlug: project.slug, data, timestamp: now() },
    { notifiers, channels: [...channels, ...targets], brand: brandFor(reviewUrl), logger },
  );
}

/** Fan out a site-wide admin alert to project-less channels. */
export async function notifySystem(
  event: SystemEventName,
  data: Record<string, unknown>,
): Promise<void> {
  const { notifiers, logger } = getStore();
  if (notifiers.length === 0) {
    return;
  }
  await emitSystemNotification(
    { event, data, timestamp: now() },
    { notifiers, channels: await loadChannels(null), brand: brandFor(), logger },
  );
}

/** Current timestamp for notification envelopes. */
function now(): string {
  return new Date().toISOString();
}
