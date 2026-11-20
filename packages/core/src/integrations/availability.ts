/**
 * Which registered integrations a project is offered (issue #1126, ADR 0049 amendment): built-ins
 * are registered, but offered only when the server can deliver them. Evaluated once at startup.
 */
import type { DesignProvider } from "../adapters/design.ts";
import type { IntegrationAvailability } from "../adapters/metadata.ts";
import type { NotifierProvider } from "../adapters/notifier/provider.ts";
import { sanitizeErrorText } from "../utils/redact.ts";

/** Longest reason kept from a throwing availability check. */
const REASON_MAX_LENGTH = 200;

/** How an integration stands on this server. */
export type IntegrationState = "available" | "unavailable" | "disabled";

/** One integration kind as the System page and the deep health report show it. */
export interface IntegrationStatus {
  /** `notifiers` (git, chat, email) or `design`. */
  readonly group: "notifiers" | "design";
  readonly kind: string;
  readonly name: string;
  readonly state: IntegrationState;
  /** Why it is not offered; absent while available. Never a secret. */
  readonly reason?: string;
}

/** The providers projects are offered, and the standing of every kind. */
export interface OfferedIntegrations {
  /** Available notifiers: the only ones settings, the API, MCP and delivery see. */
  notifiers: NotifierProvider[];
  /** Available design providers. */
  design: DesignProvider[];
  /** Every registered kind plus every built-in kind the operator turned off. */
  statuses: IntegrationStatus[];
}

/** The reason recorded for a built-in kind the operator left out. */
export const TURNED_OFF_REASON = "Turned off by the operator";

interface Offerable {
  readonly metadata: { readonly kind: string; readonly name: string };
  availability?(): IntegrationAvailability;
}

/**
 * A provider's availability: absent means available, and a throwing check reads as unavailable with
 * its message, so one broken provider never stops the server.
 */
export function availabilityOf(provider: Offerable): IntegrationAvailability {
  if (provider.availability === undefined) {
    return "available";
  }
  try {
    return provider.availability();
  } catch (error) {
    // The reason reaches project admins in a 400: never raw exception text.
    const message = error instanceof Error ? error.message : String(error);
    return { unavailable: sanitizeErrorText(message, REASON_MAX_LENGTH) };
  }
}

/** The status of one registered provider. */
function statusOf(group: IntegrationStatus["group"], provider: Offerable): IntegrationStatus {
  const { kind, name } = provider.metadata;
  const availability = availabilityOf(provider);
  return availability === "available"
    ? { group, kind, name, state: "available" }
    : { group, kind, name, state: "unavailable", reason: availability.unavailable };
}

/** Statuses of one group: each registered provider, then each built-in kind left out. */
function groupStatuses(
  group: IntegrationStatus["group"],
  registered: readonly Offerable[],
  builtIn: readonly Offerable[],
): IntegrationStatus[] {
  const kinds = new Set(registered.map((provider) => provider.metadata.kind));
  const turnedOff = builtIn
    .filter((provider) => !kinds.has(provider.metadata.kind))
    .map((provider): IntegrationStatus => ({
      group,
      kind: provider.metadata.kind,
      name: provider.metadata.name,
      state: "disabled",
      reason: TURNED_OFF_REASON,
    }));
  return [...registered.map((provider) => statusOf(group, provider)), ...turnedOff];
}

/**
 * Split the resolved providers into those offered to projects and a status for every kind. A
 * built-in kind missing from the resolved lists was turned off by the operator (an array, a filter
 * function, `false` or `SHELF_INTEGRATIONS_DISABLED`).
 */
export function offerIntegrations(
  resolved: { notifiers: readonly NotifierProvider[]; design: readonly DesignProvider[] },
  builtIn: { notifiers: readonly NotifierProvider[]; design: readonly DesignProvider[] },
): OfferedIntegrations {
  const statuses = [
    ...groupStatuses("notifiers", resolved.notifiers, builtIn.notifiers),
    ...groupStatuses("design", resolved.design, builtIn.design),
  ];
  // Each check ran once, above; the offered lists follow its answer.
  const offered = (group: IntegrationStatus["group"], provider: Offerable): boolean =>
    statuses.some(
      (status) =>
        status.group === group &&
        status.kind === provider.metadata.kind &&
        status.state === "available",
    );
  return {
    notifiers: resolved.notifiers.filter((provider) => offered("notifiers", provider)),
    design: resolved.design.filter((provider) => offered("design", provider)),
    statuses,
  };
}
