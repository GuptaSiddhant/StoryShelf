import type { EmailSender } from "../../adapters/email-sender.ts";
import type { Logger } from "../../logger.ts";
import { smtpPreset } from "./smtp.ts";
import type { SesPresetOptions } from "./types.ts";

/** An AWS region id such as `eu-west-1` or `us-gov-east-1`; anything else never reaches a hostname. */
const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/u;

/** The SES SMTP endpoint for `region` (`email-smtp.<region>.amazonaws.com`). */
export function sesSmtpHost(region: string): string {
  if (!REGION.test(region)) {
    throw new Error(`SES region "${region}" is not an AWS region id (for example eu-west-1)`);
  }
  return `email-smtp.${region}.amazonaws.com`;
}

/**
 * Amazon SES over SMTP: port 587 with STARTTLS, no AWS SDK. `user` and `pass` are the SES SMTP
 * credentials (derived from an IAM user, not the access key itself). `from` must be a verified
 * SES identity. Needs the optional `nodemailer` peer, like {@link smtpPreset}.
 */
export async function sesPreset(
  options: SesPresetOptions & { logger?: Logger },
): Promise<EmailSender> {
  return await smtpPreset({
    host: sesSmtpHost(options.region),
    port: 587,
    secure: false,
    requireTLS: true,
    user: options.user,
    pass: options.pass,
    from: options.from,
    logger: options.logger,
  });
}

/**
 * SES sender from the environment (`SES_REGION` or `AWS_REGION`, `SES_SMTP_USER`,
 * `SES_SMTP_PASS`, `SES_FROM`). Returns undefined unless all four resolve, so unconfigured
 * servers keep current behavior.
 */
export async function sesPresetFromEnv(
  env: Record<string, string | undefined> = process.env,
  logger?: Logger,
): Promise<EmailSender | undefined> {
  const region = env["SES_REGION"] ?? env["AWS_REGION"];
  const user = env["SES_SMTP_USER"];
  const pass = env["SES_SMTP_PASS"];
  const from = env["SES_FROM"];
  if (!region || !user || !pass || !from) {
    return undefined;
  }
  return await sesPreset({ region, user, pass, from, logger });
}
