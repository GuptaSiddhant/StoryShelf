/**
 * One browser or device a person registered for web push (ADR 0048, decision 4). `endpoint` is the
 * push service URL and is unique; `p256dh` and `auth` are that device's keys. None of the three is
 * ever logged. The row is deleted with its user.
 */
export interface PushSubscriptionRow {
  id: string;
  userId: string;
  /** Push service URL for this device (unique). */
  endpoint: string;
  /** The device's public key (base64url). */
  p256dh: string;
  /** The device's auth secret (base64url). */
  auth: string;
  /** A name the person gave the device, or null. */
  label: string | null;
  createdAt: string;
  /** ISO-8601 time of the last accepted send, null before the first. */
  lastSuccessAt: string | null;
  /** Failed sends since the last success. */
  failureCount: number;
}
