/**
 * Built-in integrations (ADR 0049): the providers core registers by default, by group, and how the
 * operator's options turn into the lists the app registers.
 *
 * Each move task (git, chat, email, Figma, push) adds its own providers here. A built-in sends nothing until a project configures it.
 */
import type { DesignProvider } from "../adapters/design.ts";
import type { EmailSender } from "../adapters/email-sender.ts";
import type { NotifierProvider } from "../adapters/notifier/provider.ts";
import { designReasons, emailSenderReasons, notifierReasons } from "../adapters/validate.ts";
import { BUILT_IN_INTEGRATIONS, type BuiltInIntegrations } from "./built-in.ts";
import {
  resolveIntegrationGroup,
  type IntegrationGroup,
  type IntegrationOption,
} from "./resolve.ts";

export { BUILT_IN_INTEGRATIONS, type BuiltInIntegrations } from "./built-in.ts";
export {
  availabilityOf,
  offerIntegrations,
  TURNED_OFF_REASON,
  type IntegrationState,
  type IntegrationStatus,
  type OfferedIntegrations,
} from "./availability.ts";
export { INTEGRATIONS_DISABLED_VAR, integrationsFromEnv, type EnvIntegrations } from "./env.ts";

/** The operator's choice for each integration group (ADR 0049, decision 3). */
export interface IntegrationOptions {
  notifiers?: IntegrationOption<NotifierProvider>;
  email?: IntegrationOption<EmailSender>;
  design?: IntegrationOption<DesignProvider>;
}

/** The lists the app registers, after resolution. */
export interface ResolvedIntegrations {
  notifiers: NotifierProvider[];
  email: EmailSender[];
  design: DesignProvider[];
}

/** The three groups: their option paths and adapter contracts. */
export const INTEGRATION_GROUPS = {
  notifiers: { name: "notifications.notifiers", reasons: notifierReasons },
  email: { name: "notifications.email", reasons: emailSenderReasons },
  design: { name: "design", reasons: designReasons },
} as const satisfies Record<keyof ResolvedIntegrations, IntegrationGroup>;

/**
 * Resolve every integration group once, at startup, against `builtIn` (default
 * {@link BUILT_IN_INTEGRATIONS}). Throws when an item breaks its adapter contract or a provider
 * kind repeats within a group, naming the kind.
 */
export function resolveShelfIntegrations(
  options: IntegrationOptions,
  builtIn: BuiltInIntegrations = BUILT_IN_INTEGRATIONS,
): ResolvedIntegrations {
  const groups = INTEGRATION_GROUPS;
  return {
    notifiers: resolveIntegrationGroup(groups.notifiers, builtIn.notifiers, options.notifiers),
    email: resolveIntegrationGroup(groups.email, builtIn.email, options.email),
    design: resolveIntegrationGroup(groups.design, builtIn.design, options.design),
  };
}

export {
  gitHubNotifier,
  gitLabNotifier,
  gitLogNotifier,
  gitNotifiers,
  githubConfigSchema,
  gitlabConfigSchema,
  logConfigSchema,
} from "./git/index.ts";

export {
  assertUniqueKinds,
  resolveIntegrationGroup,
  resolveIntegrations,
  type IntegrationGroup,
  type IntegrationOption,
} from "./resolve.ts";

export {
  createFigmaClient,
  createFigmaDesign,
  createFigmaOAuth,
  fetchFigmaMetas,
  fetchFigmaRenders,
  figmaOAuthFromEnv,
  parseFigmaUrl,
  type FigmaDesignOptions,
  type FigmaOAuthOptions,
} from "./design/figma/index.ts";

export {
  builtInEmailNotifier,
  createEmailNotifier,
  emailChannelConfigSchema,
  httpPreset,
  logPreset,
  mailpitPreset,
  NODEMAILER_RANGE,
  smtpPreset,
  smtpPresetFromEnv,
  type EmailChannelConfig,
  type EmailNotifierDefaults,
  type HttpPresetOptions,
  type SmtpPresetOptions,
} from "./email/index.ts";

export {
  chatNotifiers,
  chatTogglesSchema,
  logConfigSchema as chatLogConfigSchema,
  logNotifier,
  slackWebhookConfigSchema,
  slackWebhookNotifier,
  teamsWorkflowConfigSchema,
  teamsWorkflowNotifier,
  type ChatToggles,
} from "./chat/index.ts";
