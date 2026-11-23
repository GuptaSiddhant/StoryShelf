import { z } from "zod";
import { fromBase64Url } from "./base64url.ts";

/** Longest endpoint kept: the `push_subscriptions.endpoint` column is VARCHAR(512) on MySQL. */
export const MAX_ENDPOINT_LENGTH = 512;

const BASE64URL = /^[A-Za-z0-9_-]+$/u;

/** A base64url string that decodes to the given size (and, for a key, its leading byte). */
function bytes(size: number, lead?: number): z.ZodString {
  return z.string().refine(
    (text) => {
      if (!BASE64URL.test(text)) {
        return false;
      }
      const raw = fromBase64Url(text);
      return raw.length === size && (lead === undefined || raw[0] === lead);
    },
    { message: `must be base64url of ${String(size)} bytes` },
  );
}

/**
 * The device a push goes to: the three values a browser hands over when it subscribes. The
 * endpoint is `https:` and fits the column, `p256dh` is an uncompressed P-256 point and `auth` is
 * 16 bytes (RFC 8291).
 */
export const pushChannelConfigSchema = z.object({
  endpoint: z.url({ protocol: /^https$/u }).max(MAX_ENDPOINT_LENGTH),
  p256dh: bytes(65, 0x04),
  auth: bytes(16),
});

/** Config of one push device (a `push_subscriptions` row). Never log any of it. */
export type PushChannelConfig = z.infer<typeof pushChannelConfigSchema>;

/** Server-wide VAPID configuration as configured (RFC 8292). `privateKey` is a secret. */
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
  /** A path on the app's own origin (never an absolute URL), present only with a confirmed origin. */
  url?: string | undefined;
}
