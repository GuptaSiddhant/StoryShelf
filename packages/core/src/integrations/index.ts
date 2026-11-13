/**
 * Built-in integrations (ADR 0049): the providers core registers by default, by group, and how the
 * operator's options turn into the lists the app registers.
 *
 * Each group starts empty; every move task (git, chat, email, Figma, push) adds its own providers
 * here. A built-in sends nothing until a project configures it.
 */
import type { DesignProvider } from "../adapters/design.ts";
import type { EmailSender } from "../adapters/email-sender.ts";
import type { NotifierProvider } from "../adapters/notifier/provider.ts";
import { designReasons, emailSenderReasons, notifierReasons } from "../adapters/validate.ts";
import { builtInEmailNotifier } from "./email/index.ts";
import {
  resolveIntegrationGroup,
  type IntegrationGroup,
  type IntegrationOption,
} from "./resolve.ts";

/** The integrations core ships, by group. */
export interface BuiltInIntegrations {
  readonly notifiers: readonly NotifierProvider[];
  readonly email: readonly EmailSender[];
  readonly design: readonly DesignProvider[];
}

/** Every built-in integration, by group. */
export const BUILT_IN_INTEGRATIONS: BuiltInIntegrations = Object.freeze({
  notifiers: Object.freeze([builtInEmailNotifier()]),
  email: Object.freeze([]),
  design: Object.freeze([]),
});

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
  assertUniqueKinds,
  resolveIntegrationGroup,
  resolveIntegrations,
  type IntegrationGroup,
  type IntegrationOption,
} from "./resolve.ts";

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
