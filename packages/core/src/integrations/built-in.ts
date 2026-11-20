/**
 * The providers core registers by default (ADR 0049), by group. Kept apart from `index.ts` so the
 * environment reader (`env.ts`) can name the known kinds without an import cycle.
 */
import type { DesignProvider } from "../adapters/design.ts";
import type { EmailSender } from "../adapters/email-sender.ts";
import type { NotifierProvider } from "../adapters/notifier/provider.ts";
import { chatNotifiers } from "./chat/index.ts";
import { createFigmaDesign, figmaOAuthFromEnv } from "./design/figma/index.ts";
import { builtInEmailNotifier } from "./email/index.ts";
import { gitNotifiers } from "./git/index.ts";

/** The integrations core ships, by group. */
export interface BuiltInIntegrations {
  readonly notifiers: readonly NotifierProvider[];
  readonly email: readonly EmailSender[];
  readonly design: readonly DesignProvider[];
}

/** Every built-in integration, by group. */
export const BUILT_IN_INTEGRATIONS: BuiltInIntegrations = Object.freeze({
  notifiers: Object.freeze([...gitNotifiers, builtInEmailNotifier(), ...chatNotifiers]),
  email: Object.freeze([]),
  // Figma OAuth stays off without the operator's client id and secret; personal tokens still work.
  design: Object.freeze([createFigmaDesign({ oauth: figmaOAuthFromEnv() })]),
});
