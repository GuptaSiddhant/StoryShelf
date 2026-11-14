import type { EmailSender } from "../../adapters/email-sender.ts";
import type { AdapterHealth } from "../../adapters/metadata.ts";
import { version } from "./version.ts";

/** What the unconfigured sender says about itself and to a send. */
export const NOT_CONFIGURED =
  "Email has no transport: set SMTP_HOST and SMTP_FROM or configure a sender";

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
    lifecycle: {
      setup: async (): Promise<void> => {
        await Promise.resolve();
      },
      teardown: async (): Promise<void> => {
        await Promise.resolve();
      },
      health: async (): Promise<AdapterHealth> =>
        await Promise.resolve({ ok: false, detail: NOT_CONFIGURED }),
    },
    // oxlint-disable-next-line eslint/require-await -- send is async by contract
    async send(): Promise<void> {
      throw new Error(NOT_CONFIGURED);
    },
  };
}
