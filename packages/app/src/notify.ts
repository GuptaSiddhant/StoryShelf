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
import { COMMENT_MENTIONED, matchesEvent } from "@storyshelf/core/utils";
import { credentialKeys } from "./credential-keys.ts";
import { clearPaused, notificationOrigin, warnPaused } from "./notifications-pause.ts";
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

/** Absolute review URL for a project page under the resolved public origin. */
function reviewUrlFor(origin: string, slug: string, suffix: string): string {
  return `${origin}/projects/${slug}${suffix}`;
}

/**
 * The origin notifications link to; `undefined` (after one log line per pause) while none is
 * resolved, which pauses every notification (ADR 0014, decision 11).
 */
async function originOrPause(
  deps: Pick<NotifyDeps, "config" | "publicOrigin" | "logger">,
  event: string,
): Promise<string | undefined> {
  const origin = await notificationOrigin(deps);
  if (origin === undefined) {
    warnPaused(deps.logger, event);
  } else {
    clearPaused(deps.logger);
  }
  return origin;
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

/** Subscriptions matching an event (enabled + allowlist, alias included). */
function matchingSubs(
  rows: NotificationSubscriptionRow[],
  event: string,
  data: Record<string, unknown>,
): NotificationSubscriptionRow[] {
  return rows.filter(
    (row) => row.enabled && matchesEvent(NotificationSubscriptionModel.eventsOf(row), event, data),
  );
}

/** Stored channels that admit the event; the core fan-out then needs no filter of its own. */
function admittedChannels(
  channels: NotificationChannel[],
  event: string,
  data: Record<string, unknown>,
): NotificationChannel[] {
  return channels
    .filter((channel) => matchesEvent(channel.events, event, data))
    .map((channel) => Object.assign({}, channel, { events: [] }));
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

/**
 * Topics that reach a project's approvers and admins unless they opted out (ADR 0013, decision 4).
 * Every other topic (`design:changed` included) reaches only people who subscribed to it.
 */
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
  skipUsers: ReadonlySet<string>,
): Promise<NotificationChannel[]> {
  if (!wired.has("email")) {
    return [];
  }
  const subscribed = new Set(rows.map((row) => row.userId));
  const members = (await new MemberModel(db).list(projectId)).filter(
    (member) =>
      REVIEWER_ROLES.has(member.role) &&
      !subscribed.has(member.userId) &&
      !skipUsers.has(member.userId),
  );
  const targets = await Promise.all(
    members.map(async (member) => await emailTarget(db, projectId, member.userId)),
  );
  return targets.flat();
}

/** The default email target of one user (none for a missing or disabled account). */
async function emailTarget(
  db: DatabaseAdapter,
  projectId: string,
  userId: string,
): Promise<NotificationChannel[]> {
  const user = await new UserModel(db).get(userId);
  return !user || user.disabled
    ? []
    : [
        {
          id: `default:${projectId}:${userId}`,
          projectId,
          provider: "email",
          config: { to: user.email },
          events: [],
          enabled: true,
        },
      ];
}

/** Per-subscriber targets for an event (only kinds that are wired). */
async function subscriberTargets(
  db: DatabaseAdapter,
  projectId: string,
  event: string,
  data: Record<string, unknown>,
  wired: ReadonlySet<string>,
  skipUsers: ReadonlySet<string>,
): Promise<NotificationChannel[]> {
  const all = await new NotificationSubscriptionModel(db).list(projectId);
  const rows = all.filter((row) => !skipUsers.has(row.userId));
  const nested = await Promise.all(
    matchingSubs(rows, event, data).map(async (sub) => await targetsForSub(db, sub, wired)),
  );
  const defaults = DEFAULT_ON_EVENTS.has(event)
    ? await defaultTargets(db, projectId, all, wired, skipUsers)
    : [];
  return [...nested.flat(), ...defaults];
}

/** Narrowing options of a project fan-out. */
export interface NotifyOptions {
  /**
   * Users who already get this event another way (a mention, or an assignment from the component
   * owners): their subscriptions and the default recipients skip it.
   */
  skipUsers?: ReadonlySet<string>;
}

/** Send one event to the given channels with the brand and a review link under `origin`. */
async function deliver(
  deps: NotifyDeps,
  project: Pick<Project, "id" | "slug">,
  message: { event: string; data: Record<string, unknown>; reviewUrl: string | undefined },
  channels: NotificationChannel[],
): Promise<void> {
  await emitNotifications(
    {
      event: message.event,
      projectId: project.id,
      projectSlug: project.slug,
      data: message.data,
      timestamp: now(),
    },
    {
      notifiers: deps.notifiers,
      channels,
      brand: brandFor(deps.ui, deps.notificationsConfig, message.reviewUrl),
      logger: deps.logger,
      onOutcome: recordOutcomes(deps),
    },
  );
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
  options: NotifyOptions = {},
): Promise<void> {
  if (deps.notifiers.length === 0) {
    return;
  }
  const origin = await originOrPause(deps, event);
  if (origin === undefined) {
    return;
  }
  const reviewUrl = reviewSuffix ? reviewUrlFor(origin, project.slug, reviewSuffix) : undefined;
  const wired = new Set(deps.notifiers.map((candidate) => candidate.metadata.kind));
  const channels = admittedChannels(await loadChannels(deps, project.id), event, data);
  const targets = await subscriberTargets(
    deps.db,
    project.id,
    event,
    data,
    wired,
    options.skipUsers ?? new Set(),
  );
  await deliver(deps, project, { event, data, reviewUrl }, [...channels, ...targets]);
}

/**
 * Where a mention of `userId` is delivered (#463): their own subscription's channels when they
 * have one and it is enabled (a disabled one opts them out), else a default email. Never a stored
 * project channel: a mention is addressed to one person and must not reach a room.
 */
async function mentionTargets(
  db: DatabaseAdapter,
  projectId: string,
  userId: string,
  wired: ReadonlySet<string>,
): Promise<NotificationChannel[]> {
  const rows = await new NotificationSubscriptionModel(db).list(projectId);
  const own = rows.find((row) => row.userId === userId);
  if (own !== undefined) {
    return own.enabled ? await targetsForSub(db, own, wired) : [];
  }
  return wired.has("email") ? await emailTarget(db, projectId, userId) : [];
}

/**
 * Where a review request is delivered to a member assigned as a component owner (#465): their own
 * subscription's channels when it is enabled, else a default email. Being assigned overrides an
 * opt-out (a disabled subscription, or a topic list without `review:requested`), because someone
 * asked for this person by name. Never a stored project channel: the request is for one person.
 */
async function assignedTargets(
  db: DatabaseAdapter,
  projectId: string,
  userId: string,
  wired: ReadonlySet<string>,
  notifiers: readonly NotifierProvider[],
): Promise<NotificationChannel[]> {
  const own = (await new NotificationSubscriptionModel(db).list(projectId)).find(
    (row) => row.userId === userId,
  );
  // A state channel (git) cannot carry a request to a person, so it never counts as a target.
  const chosen = own?.enabled
    ? (await targetsForSub(db, own, wired)).filter(
        (channel) => !NotificationChannelModel.isStateKind(notifiers, channel.provider),
      )
    : [];
  if (chosen.length > 0) {
    return chosen;
  }
  return wired.has("email") ? await emailTarget(db, projectId, userId) : [];
}

/**
 * Send a review request to one member assigned from the component owners. The regular fan-out
 * skips them (see `NotifyOptions.skipUsers`), so they get exactly one message per cycle.
 */
export async function notifyAssignedWith(
  deps: NotifyDeps,
  project: Pick<Project, "id" | "slug">,
  userId: string,
  data: Record<string, unknown>,
  reviewSuffix: string,
): Promise<void> {
  if (deps.notifiers.length === 0) {
    return;
  }
  const event = "review:requested";
  const origin = await originOrPause(deps, event);
  if (origin === undefined) {
    return;
  }
  const wired = new Set(deps.notifiers.map((candidate) => candidate.metadata.kind));
  const targets = await assignedTargets(deps.db, project.id, userId, wired, deps.notifiers);
  const reviewUrl = reviewUrlFor(origin, project.slug, reviewSuffix);
  await deliver(deps, project, { event, data, reviewUrl }, targets);
}

/** Notify one project member that a comment mentions them. Best-effort, like every fan-out. */
export async function notifyMentionWith(
  deps: NotifyDeps,
  project: Pick<Project, "id" | "slug">,
  userId: string,
  data: Record<string, unknown>,
  reviewSuffix: string,
): Promise<void> {
  if (deps.notifiers.length === 0) {
    return;
  }
  const origin = await originOrPause(deps, COMMENT_MENTIONED);
  if (origin === undefined) {
    return;
  }
  const wired = new Set(deps.notifiers.map((candidate) => candidate.metadata.kind));
  const targets = await mentionTargets(deps.db, project.id, userId, wired);
  const reviewUrl = reviewUrlFor(origin, project.slug, reviewSuffix);
  await deliver(deps, project, { event: COMMENT_MENTIONED, data, reviewUrl }, targets);
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
  options?: NotifyOptions,
): Promise<void> {
  await notifyProjectWith(getStore(), project, event, data, reviewSuffix, options);
}

/** Fan out a site-wide admin alert to project-less channels. */
export async function notifySystemWith(
  deps: NotifyDeps,
  event: SystemEventName,
  data: Record<string, unknown>,
): Promise<void> {
  if (deps.notifiers.length === 0 || (await originOrPause(deps, event)) === undefined) {
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
