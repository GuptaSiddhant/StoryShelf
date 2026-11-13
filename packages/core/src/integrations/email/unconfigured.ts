import type { EmailSender } from "../../adapters/email-sender.ts";
import { version } from "./version.ts";

/**
 * The transport of the built-in email notifier until an operator wires one (ADR 0049): sending
 * fails with a message naming the fix, so a channel on an unconfigured server reports it instead
 * of dropping mail silently.
 */
export function unconfiguredSender(): EmailSender {
  return {
    metadata: {
      name: "Unconfigured",
      version: version(),
      kind: "email-none",
      category: "notifier",
    },
    // oxlint-disable-next-line eslint/require-await -- send is async by contract
    async send(): Promise<void> {
      throw new Error("Email has no transport: set SMTP_HOST and SMTP_FROM or configure a sender");
    },
  };
}
