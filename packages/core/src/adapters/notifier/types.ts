/** Shared event envelope for human-facing notifications. */
export interface NotificationEvent {
  event: string;
  projectId?: string;
  projectSlug?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

/** Per-channel display toggles (Brand + toggles v1, no custom templates). */
export interface ChannelToggles {
  style?: "compact" | "verbose";
  subjectPrefix?: string;
  includeAuthor?: boolean;
  includeMessage?: boolean;
  includeCounts?: boolean;
}

/** Brand inputs reused from UIConfig plus the review URL. */
export interface NotificationBrand {
  name?: string;
  logo?: string;
  reviewUrl?: string;
  fromEmail?: string;
  fromName?: string;
  footerText?: string;
}

/** Formatted output a provider transports (email body, chat markdown). */
export interface FormattedNotification {
  subject: string;
  text: string;
  markdown: string;
  html: string;
}

/** A configured project-level channel row (storage-agnostic view). */
export interface NotificationChannel {
  id: string;
  projectId: string | null;
  provider: string;
  config: Record<string, unknown>;
  secret?: string;
  events: string[];
  enabled: boolean;
}

/** App-level (site-wide) admin alert — no project scope. */
export interface SystemNotification {
  event: SystemEventName;
  data: Record<string, unknown>;
  timestamp: string;
}

/** Site-wide events for admins (new users, failures, purge). */
export type SystemEventName =
  | "sys:user-created"
  | "sys:invite-issued"
  | "sys:auth-failed"
  | "sys:capture-failed"
  | "sys:purge-completed";
