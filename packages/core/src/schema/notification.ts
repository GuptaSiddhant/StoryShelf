/** A project (or site-wide) notification channel row. */
export interface NotificationChannelRow {
  id: string;
  /** Owning project, or null for site-wide admin (`sys:*`) channels. */
  projectId: string | null;
  /** Provider kind (e.g. "slack-webhook", "teams-workflow", "email"). */
  provider: string;
  /** JSON-serialized provider config (toggles, addresses; never secrets). */
  config: string;
  /** AES-256-GCM secret (webhook URL / SMTP pass), null when none. */
  secretEncrypted: string | null;
  /** JSON array of subscribed events, or null for all. */
  events: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A per-user opt-in row for project notifications. */
export interface NotificationSubscriptionRow {
  id: string;
  projectId: string;
  userId: string;
  /** JSON array of subscribed events, or null for all. */
  events: string | null;
  /** JSON array of channels (e.g. ["email"]); v1 supports email only. */
  via: string | null;
  enabled: boolean;
  createdAt: string;
}
