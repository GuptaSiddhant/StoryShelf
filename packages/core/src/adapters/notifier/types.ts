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

/**
 * What a `state` provider shows for a build: pending, passed, failed, or cancelled by a user
 * (a host without a cancelled state shows it like the nearest failure-class state).
 */
export type NotifierState = "pending" | "success" | "failure" | "cancelled";

/**
 * One per-story finding a host that supports it (GitHub check runs) shows beside a status: a
 * changed snapshot that deep-links to its review page.
 */
export interface StateAnnotation {
  /** The story file the snapshot belongs to (the host anchors the finding there). */
  path: string;
  /** Short heading, e.g. `Button / Primary (chromium)`. */
  title: string;
  message: string;
  /** Absolute link to the snapshot's review page. */
  url: string;
  level: "notice" | "warning";
}

/** Where a `state` provider writes: a commit status or a pull-request comment. */
export type NotifierStateTarget =
  | {
      kind: "status";
      sha: string;
      /** Full status name on the host, e.g. `storyshelf/testing` (the caller owns the prefix). */
      context: string;
      /** Short text beside the status; the provider supplies a default. */
      description?: string;
      /** For a `pending` state: not started (`queued`) or under way (`running`; the default). */
      progress?: "queued" | "running";
      /** Never a merge gate (the Storybook status): a failure is shown as neutral where the host has it. */
      informational?: boolean;
      /** Per-snapshot findings of the build; only a host with annotations shows them. */
      annotations?: StateAnnotation[];
      /** Changed snapshots beyond `annotations` (cut at the cap); the host says "and N more". */
      omitted?: number;
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
