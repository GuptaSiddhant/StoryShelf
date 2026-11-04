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
import type {
  NotificationsConfig,
  ShelfConfig,
  ShelfOptions,
  UIConfig,
} from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import {
  MemberModel,
  NotificationChannelModel,
  NotificationSubscriptionModel,
  UserModel,
  type PublicOriginResolver,
} from "@storyshelf/core/models";
import type { NotificationSubscriptionRow, User } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { COMMENT_MENTIONED, matchesEvent } from "@storyshelf/core/utils";
import { credentialKeys } from "./credential-keys.ts";
import { clearPaused, notificationOrigin, warnPaused } from "./notifications-pause.ts";
import type { ServerRuntime } from "./runtime.ts";
import { getStore } from "./store.ts";

/** Why a person is a recipient of a review request: their subscription, the default, or an assignment. */
export type ReviewRoute = "subscription" | "default" | "assigned";

/**
 * Who a queued review request is for, by reference: a stored channel by id, or a person through one
 * provider kind. Never an address, URL or secret: the job row shows up in admin pages and logs.
 */
export type ReviewTarget =
  | { kind: "channel"; channelId: string }
  | { kind: "user"; userId: string; provider: string; route: ReviewRoute };

/** One review request to one recipient, as queued: references only. */
export interface ReviewRequestJob {
  projectId: string;
  /** `<buildId>:<cycle>`: the one request of a build's review cycle. */
  eventId: string;
  target: ReviewTarget;
}

/** A resolved recipient; a person's carries who they are and why they get the message. */
interface Addressed extends NotificationChannel {
  reviewer?: { userId: string; route: ReviewRoute };
}

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
  /**
   * Queues one review request for one recipient (ADR 0040). Set on a host that polls the `notify`
   * queue; absent (serverless), review requests are delivered directly and best-effort.
   */
  reviewRequests?: ((job: ReviewRequestJob) => Promise<void>) | undefined;
}

/** The dependencies of a background fan-out, from the app's options and runtime. */
export function notifyDepsFor(options: ShelfOptions, runtime: ServerRuntime): NotifyDeps {
  return {
    db: options.database,
    config: runtime.config,
    ui: runtime.ui,
    logger: runtime.logger,
    notifiers: runtime.notifiers,
    notificationsConfig: options.notifications?.config,
    publicOrigin: runtime.publicOrigin,
  };
}

/** Absolute review URL for a project page under the resolved public origin. */
export function reviewUrlFor(origin: string, slug: string, suffix: string): string {
  return `${origin}/projects/${slug}${suffix}`;
}

/**
 * The origin notifications link to; `undefined` (after one log line per pause) while none is
 * resolved, which pauses every notification (ADR 0014, decision 11).
 */
export async function originOrPause(
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
export function recordOutcomes(
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

/** The one default-on topic, which a subscription can switch off with `reviewRequests`. */
const REVIEW_REQUESTED = "review:requested";

/** Subscriptions matching an event (enabled + allowlist, alias included, review requests on). */
function matchingSubs(
  rows: NotificationSubscriptionRow[],
  event: string,
  data: Record<string, unknown>,
): NotificationSubscriptionRow[] {
  return rows.filter(
    (row) =>
      row.enabled &&
      (event !== REVIEW_REQUESTED || row.reviewRequests) &&
      matchesEvent(NotificationSubscriptionModel.eventsOf(row), event, data),
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

/** The notifier kinds a fan-out may use, and which of them address one person. */
interface DeliveryKinds {
  /** Every wired kind. */
  wired: ReadonlySet<string>;
  /** The wired kinds whose provider declares `audience: "person"`: all a subscription may use. */
  personal: ReadonlySet<string>;
  /** Called for a subscription kind that is wired but not personal, so it can be logged. */
  skipped: (subscriptionId: string, kind: string) => void;
  /** Called for a person dropped because they have no access to the project (debug log, no address). */
  denied: (projectId: string, userId: string) => void;
}

/** Subscription kinds already logged as skipped, so each is reported once per process. */
const reportedSkips = new Set<string>();

/** The kinds of a fan-out, with the once-per-subscription-and-kind warning for room kinds. */
function deliveryKindsOf(deps: Pick<NotifyDeps, "notifiers" | "logger">): DeliveryKinds {
  return {
    wired: new Set(deps.notifiers.map((candidate) => candidate.metadata.kind)),
    personal: new Set(
      deps.notifiers
        .filter((candidate) => candidate.metadata.audience === "person")
        .map((candidate) => candidate.metadata.kind),
    ),
    denied: (projectId, userId) => {
      deps.logger.debug({ projectId, userId, reason: "no-access" }, "notification target dropped");
    },
    skipped: (subscriptionId, kind) => {
      const key = `${subscriptionId}:${kind}`;
      if (!reportedSkips.has(key)) {
        reportedSkips.add(key);
        deps.logger.warn(
          { subscriptionId, kind },
          "subscription skips a delivery kind that posts to a room; use a project channel",
        );
      }
    },
  };
}

/**
 * Whether `user` may read the project: the rule the routers use (`effectiveRole`), so site admins
 * and site-wide viewers keep working without a membership row. A subscription outlives the
 * membership (it keeps the person's preferences for when they are added back), so every personal
 * target is checked here, at delivery time, never when the subscription was made.
 */
async function hasAccess(
  db: DatabaseAdapter,
  user: Pick<User, "id" | "role">,
  projectId: string,
  kinds: Pick<DeliveryKinds, "denied">,
): Promise<boolean> {
  const role = await new MemberModel(db).effectiveRole(user.role, projectId, user.id);
  if (role === null) {
    kinds.denied(projectId, user.id);
  }
  return role !== null;
}

/**
 * Per-subscriber targets for one subscription: its personal kinds only. A kind that posts to a
 * room (or is not wired) is skipped, the former with one warning, and the rest still deliver.
 */
async function targetsForSub(
  db: DatabaseAdapter,
  sub: NotificationSubscriptionRow,
  kinds: DeliveryKinds,
  route: ReviewRoute = "subscription",
): Promise<Addressed[]> {
  const user = await new UserModel(db).get(sub.userId);
  if (!user || user.disabled || !(await hasAccess(db, user, sub.projectId, kinds))) {
    return [];
  }
  const via = NotificationSubscriptionModel.viaOf(sub);
  const wants = via.length > 0 ? via : ["email"];
  const wired = wants.filter((kind) => kinds.wired.has(kind));
  for (const kind of wired.filter((entry) => !kinds.personal.has(entry))) {
    kinds.skipped(sub.id, kind);
  }
  return wired
    .filter((kind) => kinds.personal.has(kind))
    .map((kind) => ({
      id: `sub:${sub.id}:${kind}`,
      projectId: sub.projectId,
      provider: kind,
      config: { to: user.email },
      events: [],
      enabled: true,
      reviewer: { userId: user.id, route },
    }));
}

/**
 * Topics that reach a project's approvers and admins unless they opted out (ADR 0013, decision 4).
 * Every other topic (`design:changed` included) reaches only people who subscribed to it.
 */
const DEFAULT_ON_EVENTS: ReadonlySet<string> = new Set([REVIEW_REQUESTED]);

/** Roles that review builds: the default recipients of {@link DEFAULT_ON_EVENTS}. */
const REVIEWER_ROLES: ReadonlySet<string> = new Set(["approver", "admin"]);

/**
 * Reviewers with no subscription row for the project: a default-on topic reaches them by email.
 * Anyone with a row decides for themselves (`enabled` off, `reviewRequests` off or a topic list
 * without the event opts out), so a row never adds a second message here.
 */
async function defaultTargets(
  db: DatabaseAdapter,
  projectId: string,
  rows: NotificationSubscriptionRow[],
  kinds: DeliveryKinds,
  skipUsers: ReadonlySet<string>,
): Promise<Addressed[]> {
  if (!kinds.personal.has("email")) {
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
    members.map(async (member) => await emailTarget(db, projectId, member.userId, kinds)),
  );
  return targets.flat();
}

/** The default email target of one user (none for a missing or disabled account). */
async function emailTarget(
  db: DatabaseAdapter,
  projectId: string,
  userId: string,
  kinds: Pick<DeliveryKinds, "denied">,
  route: ReviewRoute = "default",
): Promise<Addressed[]> {
  const user = await new UserModel(db).get(userId);
  return !user || user.disabled || !(await hasAccess(db, user, projectId, kinds))
    ? []
    : [
        {
          id: `default:${projectId}:${userId}`,
          projectId,
          provider: "email",
          config: { to: user.email },
          events: [],
          enabled: true,
          reviewer: { userId: user.id, route },
        },
      ];
}

/** Per-subscriber targets for an event (only kinds that are wired). */
async function subscriberTargets(
  db: DatabaseAdapter,
  projectId: string,
  event: string,
  data: Record<string, unknown>,
  kinds: DeliveryKinds,
  skipUsers: ReadonlySet<string>,
): Promise<Addressed[]> {
  const all = await new NotificationSubscriptionModel(db).list(projectId);
  const rows = all.filter((row) => !skipUsers.has(row.userId));
  const nested = await Promise.all(
    matchingSubs(rows, event, data).map(async (sub) => await targetsForSub(db, sub, kinds)),
  );
  const defaults = DEFAULT_ON_EVENTS.has(event)
    ? await defaultTargets(db, projectId, rows, kinds, skipUsers)
    : [];
  return [...nested.flat(), ...defaults];
}

/** What a queued job holds for one recipient: the channel by id, a person by who and why. */
function referenceOf(channel: Addressed): ReviewTarget {
  return channel.reviewer === undefined
    ? { kind: "channel", channelId: channel.id }
    : {
        kind: "user",
        userId: channel.reviewer.userId,
        provider: channel.provider,
        route: channel.reviewer.route,
      };
}

/**
 * Deliver a message now, or, for a review request on a host that polls the `notify` queue, queue
 * one job per recipient so each is retried alone (ADR 0040). A recipient whose job could not be
 * queued gets the direct, best-effort delivery rather than none.
 */
async function sendOrQueue(
  deps: NotifyDeps,
  project: Pick<Project, "id" | "slug">,
  message: { event: string; data: Record<string, unknown>; reviewUrl: string | undefined },
  channels: Addressed[],
): Promise<void> {
  const queue = deps.reviewRequests;
  const eventId = message.data["eventId"];
  if (message.event !== REVIEW_REQUESTED || queue === undefined || typeof eventId !== "string") {
    await deliver(deps, project, message, channels);
    return;
  }
  const queued = await Promise.all(
    channels.map(async (channel) => {
      try {
        await queue({ projectId: project.id, eventId, target: referenceOf(channel) });
        return null;
      } catch (error) {
        deps.logger.warn({ err: error, eventId }, "review request could not be queued");
        return channel;
      }
    }),
  );
  const direct = queued.filter((channel) => channel !== null);
  if (direct.length > 0) {
    await deliver(deps, project, message, direct);
  }
}

/**
 * The recipient of a queued review request as it stands now, or `undefined` when it no longer
 * applies (channel deleted or off, person disabled or opted out). Never reads the job for an address.
 */
export async function resolveReviewTarget(
  deps: NotifyDeps,
  projectId: string,
  target: ReviewTarget,
  data: Record<string, unknown>,
): Promise<NotificationChannel | undefined> {
  if (target.kind === "channel") {
    const channels = admittedChannels(await loadChannels(deps, projectId), REVIEW_REQUESTED, data);
    return channels.find((channel) => channel.id === target.channelId);
  }
  const kinds = deliveryKindsOf(deps);
  const found =
    target.route === "assigned"
      ? await assignedTargets(deps.db, projectId, target.userId, kinds)
      : await subscriberTargets(deps.db, projectId, REVIEW_REQUESTED, data, kinds, new Set());
  return found.find(
    (entry) => entry.reviewer?.userId === target.userId && entry.provider === target.provider,
  );
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
export async function deliver(
  deps: NotifyDeps,
  project: Pick<Project, "id" | "slug">,
  message: { event: string; data: Record<string, unknown>; reviewUrl: string | undefined },
  channels: NotificationChannel[],
  onOutcome: (outcome: ChannelOutcome) => Promise<void> = recordOutcomes(deps),
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
      onOutcome,
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
  const kinds = deliveryKindsOf(deps);
  const channels = admittedChannels(await loadChannels(deps, project.id), event, data);
  const targets = await subscriberTargets(
    deps.db,
    project.id,
    event,
    data,
    kinds,
    options.skipUsers ?? new Set(),
  );
  await sendOrQueue(deps, project, { event, data, reviewUrl }, [...channels, ...targets]);
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
  kinds: DeliveryKinds,
): Promise<NotificationChannel[]> {
  const rows = await new NotificationSubscriptionModel(db).list(projectId);
  const own = rows.find((row) => row.userId === userId);
  // The record of "no review requests" opts out of those and nothing else: they still get a
  // mention by default email.
  if (own !== undefined && !NotificationSubscriptionModel.isReviewOptOutOnly(own)) {
    return own.enabled ? await targetsForSub(db, own, kinds) : [];
  }
  return kinds.personal.has("email") ? await emailTarget(db, projectId, userId, kinds) : [];
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
  kinds: DeliveryKinds,
): Promise<Addressed[]> {
  const own = (await new NotificationSubscriptionModel(db).list(projectId)).find(
    (row) => row.userId === userId,
  );
  // `targetsForSub` keeps personal kinds only, so a state or room kind never counts as a target.
  const chosen = own?.enabled ? await targetsForSub(db, own, kinds, "assigned") : [];
  if (chosen.length > 0) {
    return chosen;
  }
  return kinds.personal.has("email")
    ? await emailTarget(db, projectId, userId, kinds, "assigned")
    : [];
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
  const targets = await assignedTargets(deps.db, project.id, userId, deliveryKindsOf(deps));
  const reviewUrl = reviewUrlFor(origin, project.slug, reviewSuffix);
  await sendOrQueue(deps, project, { event, data, reviewUrl }, targets);
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
  const targets = await mentionTargets(deps.db, project.id, userId, deliveryKindsOf(deps));
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
