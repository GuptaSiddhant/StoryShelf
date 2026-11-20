/**
 * What the app offers projects of each integration group (issue #1126): the store's notifiers and
 * design providers are the available ones; this module reads the rest, for site admins and for
 * refusing a channel of a kind the server cannot deliver.
 */
import type { IntegrationStatus } from "@storyshelf/core/integrations";
import type { UnofferedIntegrationView } from "./pages/integrations-unoffered.tsx";
import { getStore } from "./store.ts";

/** An integration kind not offered to projects, with why (turned off, or unavailable and why). */
export type UnofferedIntegration = UnofferedIntegrationView;

/** Every integration status (empty in hand-built stores). */
function statuses(): readonly IntegrationStatus[] {
  return getStore().integrations ?? [];
}

/** The kinds of `group` the server registers but cannot offer, or that the operator turned off. */
export function unofferedIntegrations(group: IntegrationStatus["group"]): UnofferedIntegration[] {
  return statuses()
    .filter((status) => status.group === group && status.state !== "available")
    .map((status) => ({
      kind: status.kind,
      name: status.name,
      reason: status.reason ?? status.state,
    }));
}

/** The reason given for a stored channel whose kind no registered notifier provides. */
export const NOT_REGISTERED_REASON = "Not registered on this server";

/** The kinds projects are offered: the store's notifiers are the available ones. */
export function offeredKinds(): string[] {
  return getStore().notifiers.map((provider) => provider.metadata.kind);
}

/**
 * Why a stored channel of `kind` is held back, or undefined when its kind is offered: its
 * integration's reason, or {@link NOT_REGISTERED_REASON} when no registered notifier provides it
 * (a custom notifier removed from the server's code).
 */
export function unofferedReason(kind: string): string | undefined {
  if (offeredKinds().includes(kind)) {
    return undefined;
  }
  const entry = unofferedIntegrations("notifiers").find((candidate) => candidate.kind === kind);
  return entry?.reason ?? NOT_REGISTERED_REASON;
}

/**
 * The refusal for creating a channel of an unoffered kind (400), or undefined when the kind is
 * offered or unknown (unknown kinds are refused by validation, as before).
 */
export function unofferedKindMessage(kind: string): string | undefined {
  const entry = unofferedIntegrations("notifiers").find((candidate) => candidate.kind === kind);
  return entry ? `${entry.name} is not available on this server: ${entry.reason}` : undefined;
}
