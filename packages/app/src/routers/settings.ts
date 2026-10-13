import type { ShelfRouter } from "../app-types.ts";
import { registerAiSettings } from "./settings-ai.ts";
import { registerDesignSettings } from "./settings-design.ts";
import { registerGeneralSettings } from "./settings-general.ts";
import { registerLabelSettings } from "./settings-labels.ts";
import { registerLinkSettings } from "./settings-links.ts";
import { registerMemberSettings } from "./settings-members.ts";
import { registerNotificationSettings } from "./settings-notifications.ts";
import { registerStatusSettings } from "./settings-status.ts";
import { registerTokenSettings } from "./settings-tokens.ts";
import { registerWebhookSettings } from "./settings-webhooks.ts";

/** Register the server-rendered project settings pages and their form handlers. */
export function registerSettingsPages(app: ShelfRouter): void {
  registerGeneralSettings(app);
  registerLabelSettings(app);
  registerLinkSettings(app);
  registerDesignSettings(app);
  registerTokenSettings(app);
  registerWebhookSettings(app);
  registerNotificationSettings(app);
  registerMemberSettings(app);
  registerStatusSettings(app);
  registerAiSettings(app);
}
