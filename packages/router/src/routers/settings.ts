import type { ShelfApp } from "../index.tsx";
import { registerGeneralSettings } from "./settings-general.ts";
import { registerLabelSettings } from "./settings-labels.ts";
import { registerMemberSettings } from "./settings-members.ts";
import { registerStatusSettings } from "./settings-status.ts";
import { registerTokenSettings } from "./settings-tokens.ts";
import { registerWebhookSettings } from "./settings-webhooks.ts";

/** Register the server-rendered project settings pages and their form handlers. */
export function registerSettingsPages(app: ShelfApp): void {
  registerGeneralSettings(app);
  registerLabelSettings(app);
  registerTokenSettings(app);
  registerWebhookSettings(app);
  registerMemberSettings(app);
  registerStatusSettings(app);
}
