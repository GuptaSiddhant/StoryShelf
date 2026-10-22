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
  /** Last delivery error, cleared by the next successful delivery. */
  lastError?: string;
}

/** What a `state` provider shows for a build: pending, passed or failed. */
export type NotifierState = "pending" | "success" | "failure";

/** Where a `state` provider writes: a commit status or a pull-request comment. */
export type NotifierStateTarget =
  | {
      kind: "status";
      sha: string;
      /** Full status name on the host, e.g. `storyshelf/testing` (the caller owns the prefix). */
      context: string;
      /** Short text beside the status; the provider supplies a default. */
      description?: string;
    }
  | {
      kind: "comment";
      sha: string;
      /** Comment body below the idempotency marker. */
      markdown: string;
    };

/** Result of one delivery attempt to a channel, reported to the host for health display. */
export interface ChannelOutcome {
  channelId: string;
  /** Sanitized error text, absent on success. */
  error?: string;
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
  | "sys:purge-completed"
  | "sys:notify-failed"
  | "sys:ai-budget";
