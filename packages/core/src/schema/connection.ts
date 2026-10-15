/**
 * A user's own OAuth connection to an external service (`design` providers today,
 * issue trackers later). One per user and service; tokens are encrypted at rest.
 */
export interface UserConnection {
  id: string;
  userId: string;
  /** Service `metadata.kind`, e.g. `figma`. */
  service: string;
  tokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  /** When the access token expires; null when it never does. */
  expiresAt: string | null;
  /** `ok`, or `expired` once a refresh failed and the user must reconnect. */
  status: string;
  createdAt: string;
  updatedAt: string;
}
