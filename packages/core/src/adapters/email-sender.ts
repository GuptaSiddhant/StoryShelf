import type { Adapter } from "./metadata.ts";

/** A single email message (transport-agnostic). */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
  replyTo?: string;
}

/**
 * Minimal email transport: implemented once in `@storyshelf/notify-email`,
 * consumed by notification fan-out and (optionally) the auth engine for
 * invites and password resets. Best-effort delivery; throws on failure so
 * callers can log and continue.
 */
export interface EmailSender extends Adapter<{ readonly category: "notifier" }> {
  send(message: EmailMessage): Promise<void>;
}
