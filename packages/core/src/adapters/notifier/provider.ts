import type { Logger } from "pino";
import type { z } from "zod";
import type { Adapter, AdapterMetadata } from "../metadata.ts";
import type {
  FormattedNotification,
  NotificationChannel,
  NotifierState,
  NotifierStateTarget,
} from "./types.ts";

/** How a provider delivers: `message` sends once, `state` makes a host show a named state. */
export type NotifierDelivery = "message" | "state";

/** Notifier-specific metadata (adds logo + config validation schema). */
export interface NotifierMetadata extends AdapterMetadata {
  readonly category: "notifier";
  readonly logo?: string;
  readonly schema: z.ZodType;
  /** Delivery kind; absent means `message` (chat, email). */
  readonly delivery?: NotifierDelivery;
}

/** Metadata of a `message` provider (Slack, Teams, email). */
export interface MessageNotifierMetadata extends NotifierMetadata {
  readonly delivery?: "message";
}

/** Metadata of a `state` provider (GitHub, GitLab): `delivery` is mandatory. */
export interface StateNotifierMetadata extends NotifierMetadata {
  readonly delivery: "state";
}

/** Descriptor of a `message` provider, registered at startup. */
export interface MessageNotifierProvider extends Adapter<MessageNotifierMetadata> {
  create(opts: { config: unknown; secret?: string; logger?: Logger }): MessageNotifierAdapter;
}

/** Descriptor of a `state` provider, registered at startup. */
export interface StateNotifierProvider extends Adapter<StateNotifierMetadata> {
  create(opts: { config: unknown; secret?: string; logger?: Logger }): StateNotifierAdapter;
}

/** Descriptor — registered at startup, validates per-channel config. */
export type NotifierProvider = MessageNotifierProvider | StateNotifierProvider;

/** Runtime of a `message` provider — bound to one channel config + secret, sends one message. */
export interface MessageNotifierAdapter extends Adapter<MessageNotifierMetadata> {
  send(input: {
    channel: NotificationChannel;
    formatted: FormattedNotification;
    logger?: Logger;
  }): Promise<void>;
}

/** Input of one idempotent state write. */
export interface SetStateInput {
  channel: NotificationChannel;
  /** What to make the host show: a commit status or a pull-request comment. */
  target: NotifierStateTarget;
  state: NotifierState;
  /**
   * Link back to the build page; also keys the pull-request comment. Absent while no public origin
   * is known (ADR 0007): a status then has no link and a comment is not written.
   */
  url?: string | undefined;
  logger?: Logger;
}

/**
 * Runtime of a `state` provider: idempotent, latest call wins. A provider that
 * cannot show a target kind (no comment support) skips it silently.
 */
export interface StateNotifierAdapter extends Adapter<StateNotifierMetadata> {
  setState(input: SetStateInput): Promise<void>;
}

/** Runtime — bound to one channel config + decrypted secret. */
export type NotifierAdapter = MessageNotifierAdapter | StateNotifierAdapter;

/** True when the provider delivers state (git hosts) rather than messages. */
export function isStateProvider(provider: NotifierProvider): provider is StateNotifierProvider {
  return provider.metadata.delivery === "state";
}
