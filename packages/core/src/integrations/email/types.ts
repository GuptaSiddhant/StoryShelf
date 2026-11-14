import { z } from "zod";

/** Display toggles plus addressing for email channels. */
export const emailChannelConfigSchema = z.object({
  to: z.string().min(1),
  from: z.string().min(1).optional(),
  replyTo: z.string().min(1).optional(),
  style: z.enum(["compact", "verbose"]).optional(),
  subjectPrefix: z.string().min(1).optional(),
  includeAuthor: z.boolean().optional(),
  includeMessage: z.boolean().optional(),
  includeCounts: z.boolean().optional(),
});

/** Email channel config (addressing + display toggles). */
export type EmailChannelConfig = z.infer<typeof emailChannelConfigSchema>;

/** SMTP transport options for {@link smtpPreset}. */
export interface SmtpPresetOptions {
  host: string;
  port: number;
  secure?: boolean;
  /** Fail instead of sending in plaintext when the server does not offer STARTTLS. */
  requireTLS?: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** Amazon SES SMTP options for {@link sesPreset}; `user`/`pass` are SES SMTP credentials. */
export interface SesPresetOptions {
  region: string;
  user: string;
  pass: string;
  from: string;
}

/** HTTP email-API options for {@link httpPreset} (Resend-style). */
export interface HttpPresetOptions {
  url: string;
  headers?: Record<string, string>;
  from: string;
}
