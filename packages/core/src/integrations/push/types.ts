import { z } from "zod";

/** The device a push goes to: the three values a browser hands over when it subscribes. */
export const pushChannelConfigSchema = z.object({
  endpoint: z.url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

/** Config of one push device (a `push_subscriptions` row). Never log any of it. */
export type PushChannelConfig = z.infer<typeof pushChannelConfigSchema>;

/** Server-wide VAPID configuration (RFC 8292). `privateKey` is a secret. */
export interface VapidConfig {
  /** Uncompressed P-256 public key, base64url (65 bytes). Safe to expose. */
  publicKey: string;
  /** P-256 private scalar, base64url (32 bytes). Never logged, thrown or stored. */
  privateKey: string;
  /** Contact for the push service: a `mailto:` or `https:` URL. */
  subject: string;
}

/** The JSON a service worker receives. */
export interface PushPayload {
  title: string;
  body: string;
  url?: string | undefined;
}
