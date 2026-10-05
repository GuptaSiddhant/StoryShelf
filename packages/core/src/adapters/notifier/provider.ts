import type { Logger } from "pino";
import type { z } from "zod";
import type { Adapter, AdapterMetadata } from "../metadata.ts";
import type { FormattedNotification, NotificationChannel } from "./types.ts";

/** Notifier-specific metadata (adds logo + config validation schema). */
export interface NotifierMetadata extends AdapterMetadata {
  readonly category: "notifier";
  readonly logo?: string;
  readonly schema: z.ZodType;
}

/** Descriptor — registered at startup, validates per-channel config. */
export interface NotifierProvider extends Adapter<NotifierMetadata> {
  create(opts: { config: unknown; secret?: string; logger?: Logger }): NotifierAdapter;
}

/** Runtime — bound to one channel config + decrypted secret, sends one message. */
export interface NotifierAdapter extends Adapter<NotifierMetadata> {
  send(input: {
    channel: NotificationChannel;
    formatted: FormattedNotification;
    logger?: Logger;
  }): Promise<void>;
}
