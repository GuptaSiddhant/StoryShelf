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
  type ChannelOutcome,
  type NotificationBrand,
  type NotificationChannel,
  type SystemEventName,
} from "@storyshelf/core/adapter/notifier";
import type { NotificationsConfig, ShelfConfig, UIConfig } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import {
  MemberModel,
  NotificationChannelModel,
  NotificationSubscriptionModel,
  UserModel,
  type PublicOriginResolver,
} from "@storyshelf/core/models";
import type { NotificationSubscriptionRow } from "@storyshelf/core/schema";
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
  /** Brand/sender settings (`notifications.config`). */
  notificationsConfig?: NotificationsConfig;
  /** The public origin resolver; absent ⇒ `config.publicBaseUrl` only. */
  publicOrigin?: Pick<PublicOriginResolver, "url"> | undefined;
}

/**
 * Absolute review URL for a project page, from the resolved public origin (ADR 0007, decision 6);
 * `undefined` while none is known, so notification links that need one are omitted.
 */
async function reviewUrlForWith(
  deps: Pick<NotifyDeps, "config" | "publicOrigin">,
  slug: string,
  suffix: string,
): Promise<string | undefined> {
  const origin = (await deps.publicOrigin?.url()) ?? deps.config.publicBaseUrl;
  const base = origin?.replace(/\/+$/u, "");
  if (!base) {
    return undefined;
  }
  return `${base}/projects/${slug}${suffix}`;
}

/** Brand inputs from UI config plus the notification sender settings. */
function brandFor(
  ui: UIConfig,
  settings: NotificationsConfig | undefined,
  reviewUrl?: string,
): NotificationBrand {
  return {
    name: ui.name,
    logo: ui.logo,
    reviewUrl,
    fromEmail: settings?.fromEmail,
    fromName: settings?.fromName ?? ui.name,
    footerText: settings?.footerText,
  };
}

/** Load stored channels as send-ready views (skips undecryptable secrets). */
async function loadChannels(
  deps: Pick<NotifyDeps, "db" | "config">,
  projectId: string | null,
): Promise<NotificationChannel[]> {
  const model = channelModel(deps);
  const rows = projectId === null ? await model.listSystem() : await model.list(projectId);
  return rows.filter((row) => row.enabled).flatMap((row) => model.toView(row) ?? []);
}

/** The channel model bound to the server secret. */
function channelModel(deps: Pick<NotifyDeps, "db" | "config">): NotificationChannelModel {
  return new NotificationChannelModel(deps.db, undefined, credentialKeys(deps.config));
}

/** Record each delivery outcome on its channel row (the last error shown in settings). */
function recordOutcomes(
  deps: Pick<NotifyDeps, "db" | "config" | "logger">,
): (outcome: ChannelOutcome) => Promise<void> {
  const model = channelModel(deps);
  return async (outcome) => {
    if (outcome.channelId.startsWith("sub:") || outcome.channelId.startsWith("default:")) {
      return;
    }
    await model.recordOutcome(outcome.channelId, outcome.error).catch((error: unknown) => {
      deps.logger.warn({ err: error, channelId: outcome.channelId }, "failed to record outcome");
    });
  };
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

/** Topics that reach a project's approvers and admins unless they opted out (ADR 0013, decision 4). */
const DEFAULT_ON_EVENTS: ReadonlySet<string> = new Set(["review:requested"]);

/** Roles that review builds: the default recipients of {@link DEFAULT_ON_EVENTS}. */
const REVIEWER_ROLES: ReadonlySet<string> = new Set(["approver", "admin"]);

/**
 * Reviewers with no subscription row for the project: a default-on topic reaches them by email.
 * Anyone with a row decides for themselves (`enabled` off or a topic list without the event opts
 * out), so a row never adds a second message here.
 */
async function defaultTargets(
  db: DatabaseAdapter,
  projectId: string,
  rows: NotificationSubscriptionRow[],
  wired: ReadonlySet<string>,
): Promise<NotificationChannel[]> {
  if (!wired.has("email")) {
    return [];
  }
  const subscribed = new Set(rows.map((row) => row.userId));
  const members = (await new MemberModel(db).list(projectId)).filter(
    (member) => REVIEWER_ROLES.has(member.role) && !subscribed.has(member.userId),
  );
  const targets = await Promise.all(
    members.map(async (member): Promise<NotificationChannel[]> => {
      const user = await new UserModel(db).get(member.userId);
      return !user || user.disabled
        ? []
        : [
            {
              id: `default:${projectId}:${member.userId}`,
              projectId,
              provider: "email",
              config: { to: user.email },
              events: [],
              enabled: true,
            },
          ];
    }),
  );
  return targets.flat();
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
  const defaults = DEFAULT_ON_EVENTS.has(event)
    ? await defaultTargets(db, projectId, rows, wired)
    : [];
  return [...nested.flat(), ...defaults];
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
    ? await reviewUrlForWith(deps, project.slug, reviewSuffix)
    : undefined;
  const wired = new Set(deps.notifiers.map((candidate) => candidate.metadata.kind));
  const channels = await loadChannels(deps, project.id);
  const targets = await subscriberTargets(deps.db, project.id, event, wired);
  await emitNotifications(
    { event, projectId: project.id, projectSlug: project.slug, data, timestamp: now() },
    {
      notifiers: deps.notifiers,
      channels: [...channels, ...targets],
      brand: brandFor(deps.ui, deps.notificationsConfig, reviewUrl),
      logger: deps.logger,
      onOutcome: recordOutcomes(deps),
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
      brand: brandFor(deps.ui, deps.notificationsConfig),
      logger: deps.logger,
      onOutcome: recordOutcomes(deps),
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
