/**
 * Turning integrations off without code (issue #1126): `SHELF_INTEGRATIONS_DISABLED` names the
 * provider kinds an operator of the server image or the Fly demo does not want offered.
 */
import type { DesignProvider } from "../adapters/design.ts";
import type { NotifierProvider } from "../adapters/notifier/provider.ts";
import { BUILT_IN_INTEGRATIONS, type BuiltInIntegrations } from "./built-in.ts";

/** The variable that lists the kinds to turn off, comma-separated. */
export const INTEGRATIONS_DISABLED_VAR = "SHELF_INTEGRATIONS_DISABLED";

/** Short names accepted beside the exact kinds (`slack,teams,figma`). */
const ALIASES: Readonly<Record<string, string>> = {
  slack: "slack-webhook",
  teams: "teams-workflow",
};

/**
 * The function form of `notifications.notifiers` and `design` (ADR 0049, decision 3) with the
 * turned-off kinds filtered out. Both are always functions, so a server can compose them with its
 * own replacements (the SMTP-backed `email` notifier).
 */
export interface EnvIntegrations {
  /** The kinds turned off, after aliases (empty when the variable is unset). */
  readonly disabled: readonly string[];
  readonly notifiers: (builtIn: readonly NotifierProvider[]) => NotifierProvider[];
  readonly design: (builtIn: readonly DesignProvider[]) => DesignProvider[];
}

/** Every built-in kind, the ones the variable may name. */
function knownKinds(builtIn: BuiltInIntegrations): Set<string> {
  return new Set(
    [...builtIn.notifiers, ...builtIn.design].map((provider) => provider.metadata.kind),
  );
}

/** The kinds the variable names, trimmed, lower-cased and de-aliased. */
function namedKinds(raw: string | undefined): string[] {
  const names = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  return [...new Set(names.map((name) => ALIASES[name] ?? name))];
}

/**
 * Read `SHELF_INTEGRATIONS_DISABLED` (comma-separated provider kinds, e.g. `slack,teams,figma`).
 * Throws at startup when it names a kind no built-in integration has, naming that kind and the
 * known ones. Unset or blank turns nothing off.
 */
export function integrationsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  builtIn: BuiltInIntegrations = BUILT_IN_INTEGRATIONS,
): EnvIntegrations {
  const disabled = namedKinds(env[INTEGRATIONS_DISABLED_VAR]);
  const known = knownKinds(builtIn);
  const unknown = disabled.filter((kind) => !known.has(kind));
  if (unknown.length > 0) {
    throw new Error(
      `${INTEGRATIONS_DISABLED_VAR}: unknown integration kind "${unknown.join('", "')}"; ` +
        `known kinds: ${[...known, ...Object.keys(ALIASES)].toSorted().join(", ")}`,
    );
  }
  const off = new Set(disabled);
  return {
    disabled,
    notifiers: (providers) => providers.filter((provider) => !off.has(provider.metadata.kind)),
    design: (providers) => providers.filter((provider) => !off.has(provider.metadata.kind)),
  };
}
