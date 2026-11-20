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

/** Why a notifier kind is not offered, or undefined when it is (or is unknown to the server). */
export function unofferedReason(kind: string): string | undefined {
  return unofferedIntegrations("notifiers").find((entry) => entry.kind === kind)?.reason;
}

/**
 * The refusal for creating a channel of an unoffered kind (400), or undefined when the kind is
 * offered or unknown (unknown kinds are refused by validation, as before).
 */
export function unofferedKindMessage(kind: string): string | undefined {
  const entry = unofferedIntegrations("notifiers").find((candidate) => candidate.kind === kind);
  return entry ? `${entry.name} is not available on this server: ${entry.reason}` : undefined;
}
