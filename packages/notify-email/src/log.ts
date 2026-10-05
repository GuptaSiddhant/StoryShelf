import type { EmailMessage, EmailSender } from "@storyshelf/core/adapter/email-sender";
import type { Logger } from "@storyshelf/core/logger";
import { version } from "./version.ts";

/** Log-only preset for tests and unconfigured servers (no delivery). */
export function logPreset(options: { logger?: Logger } = {}): EmailSender {
  let logger = options.logger?.child({ component: "notify-email-log" });
  return {
    metadata: { name: "Log", version: version(), kind: "email-log", category: "notifier" },
    setLogger(next: Logger): void {
      logger = next.child({ component: "notify-email-log" });
    },
    // oxlint-disable-next-line eslint/require-await -- send is async by contract
    async send(message: EmailMessage): Promise<void> {
      logger?.info({ to: message.to, subject: message.subject }, "email notification (log)");
    },
  };
}
