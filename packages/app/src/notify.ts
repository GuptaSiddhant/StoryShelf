/**
 * Notification fan-out for routers: loads stored channels and subscriber
 * emails, then delegates to the wired notifier providers. Best-effort and
 * non-fatal — failures are logged inside the emitters, never thrown here.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import {
  emitNotifications,
  emitSystemNotification,
  type NotificationBrand,
  type NotificationChannel,
  type SystemEventName,
} from "@storyshelf/core/adapter/notifier";
import type { ShelfConfig, UIConfig } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import {
  NotificationChannelModel,
  NotificationSubscriptionModel,
  UserModel,
} from "@storyshelf/core/models";
import type { NotificationSubscriptionRow } from "@storyshelf/core/schema";
import type { NotificationChannelRow } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { credentialKeys } from "./credential-keys.ts";
import { getStore } from "./store.ts";

/** Explicit dependencies for background fan-out (no request scope). */
export interface NotifyDeps {
  db: DatabaseAdapter;
  config: ShelfConfig;
  ui: UIConfig;
  logger: Logger;
  notifiers: NotifierProvider[];
}

/** Review URL for a project page (absolute when `publicBaseUrl` is set). */
export function reviewUrlFor(slug: string, suffix: string): string | undefined {
  return reviewUrlForWith(getStore().config.publicBaseUrl, slug, suffix);
}

/** Review URL from an explicit base URL (background use). */
function reviewUrlForWith(
  publicBaseUrl: string | undefined,
  slug: string,
  suffix: string,
): string | undefined {
  const base = publicBaseUrl?.replace(/\/+$/u, "");
  if (!base) {
    return undefined;
  }
  return `${base}/projects/${slug}${suffix}`;
}

/** Brand inputs from UI config plus server notification defaults. */
function brandFor(ui: UIConfig, config: ShelfConfig, reviewUrl?: string): NotificationBrand {
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
async function loadChannels(
  deps: Pick<NotifyDeps, "db" | "config">,
  projectId: string | null,
): Promise<NotificationChannel[]> {
  const model = new NotificationChannelModel(deps.db, undefined, credentialKeys(deps.config));
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
  db: DatabaseAdapter,
  projectId: string,
  event: string,
  wired: ReadonlySet<string>,
): Promise<NotificationChannel[]> {
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
export async function notifyProjectWith(
  deps: NotifyDeps,
  project: Pick<Project, "id" | "slug">,
  event: string,
  data: Record<string, unknown>,
  reviewSuffix?: string,
): Promise<void> {
  if (deps.notifiers.length === 0) {
    return;
  }
  const reviewUrl = reviewSuffix
    ? reviewUrlForWith(deps.config.publicBaseUrl, project.slug, reviewSuffix)
    : undefined;
  const wired = new Set(deps.notifiers.map((candidate) => candidate.metadata.kind));
  const channels = await loadChannels(deps, project.id);
  const targets = await subscriberTargets(deps.db, project.id, event, wired);
  await emitNotifications(
    { event, projectId: project.id, projectSlug: project.slug, data, timestamp: now() },
    {
      notifiers: deps.notifiers,
      channels: [...channels, ...targets],
      brand: brandFor(deps.ui, deps.config, reviewUrl),
      logger: deps.logger,
    },
  );
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
  await notifyProjectWith(getStore(), project, event, data, reviewSuffix);
}

/** Fan out a site-wide admin alert to project-less channels. */
export async function notifySystemWith(
  deps: NotifyDeps,
  event: SystemEventName,
  data: Record<string, unknown>,
): Promise<void> {
  if (deps.notifiers.length === 0) {
    return;
  }
  await emitSystemNotification(
    { event, data, timestamp: now() },
    {
      notifiers: deps.notifiers,
      channels: await loadChannels(deps, null),
      brand: brandFor(deps.ui, deps.config),
      logger: deps.logger,
    },
  );
}

/** Fan out a site-wide admin alert to project-less channels. */
export async function notifySystem(
  event: SystemEventName,
  data: Record<string, unknown>,
): Promise<void> {
  await notifySystemWith(getStore(), event, data);
}

/**
 * Host hook for the auth engine (`onAuthSystemEvent`): fans `sys:*` auth
 * events out to admin channels. Safe to call anywhere — outside a request
 * scope (e.g. boot) it resolves to a no-op instead of throwing.
 */
export function createAuthSystemHook(): (
  event: "sys:user-created" | "sys:invite-issued",
  data: Record<string, unknown>,
) => Promise<void> {
  return async (event, data): Promise<void> => {
    await notifySystem(event, data).catch(() => {
      // Intentionally empty — best-effort fan-out must never break auth
    });
  };
}

/** Current timestamp for notification envelopes. */
function now(): string {
  return new Date().toISOString();
}
