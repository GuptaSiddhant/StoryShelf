/**
 * The operator function form of ADR 0049, decision 3: how one integration group's option turns into
 * the list the app registers, and the startup checks that list must pass.
 */

/**
 * How an operator chooses one integration group (`notifications.notifiers`, `notifications.email`,
 * `design`):
 *
 * - `undefined`: the built-in integrations;
 * - an array: exactly these, with no built-ins;
 * - a function: its result, given the built-ins (add a custom provider, replace a built-in of the
 *   same kind, or filter some out). It runs once, at startup;
 * - `false`: none.
 */
export type IntegrationOption<T> = readonly T[] | ((builtIn: readonly T[]) => readonly T[]) | false;

/**
 * The list an integration option stands for. Pure: it never validates and never copies an item, so
 * a function's result is used as it is.
 */
export function resolveIntegrations<T>(builtIn: readonly T[], option?: IntegrationOption<T>): T[] {
  if (option === undefined) {
    return [...builtIn];
  }
  if (option === false) {
    return [];
  }
  return [...(typeof option === "function" ? option(builtIn) : option)];
}

/** One integration group: its option path and the adapter contract each item must satisfy. */
export interface IntegrationGroup {
  /** The option path, used in errors (`notifications.notifiers`). */
  readonly name: string;
  /** Reasons an item breaks the adapter contract (empty when it holds). */
  readonly reasons: (item: unknown) => string[];
}

/**
 * Resolve one group and check it: every item satisfies the adapter contract and every provider kind
 * is unique. Throws at startup, naming the group, the index and the kind.
 */
export function resolveIntegrationGroup<T>(
  group: IntegrationGroup,
  builtIn: readonly T[],
  option?: IntegrationOption<T>,
): T[] {
  assertOptionShape(group, option);
  const items = resolveIntegrations(
    builtIn,
    typeof option === "function" ? returningArray(group, option) : option,
  );
  assertContracts(group, items);
  assertUniqueKinds(group, items);
  return items;
}

/** The option is one of the four forms (types alone do not stop a JavaScript config). */
function assertOptionShape(group: IntegrationGroup, option: unknown): void {
  const valid =
    option === undefined ||
    option === false ||
    typeof option === "function" ||
    Array.isArray(option);
  if (!valid) {
    throw new TypeError(`${group.name} must be an array, a function of the built-ins, or false`);
  }
}

/** `option`, refusing a result that is not an array (a JavaScript config can return anything). */
function returningArray<T>(
  group: IntegrationGroup,
  option: (builtIn: readonly T[]) => readonly T[],
): (builtIn: readonly T[]) => readonly T[] {
  return (builtIn) => {
    const result: unknown = option(builtIn);
    if (!Array.isArray(result)) {
      throw new TypeError(`${group.name}: the function must return an array of providers`);
    }
    return result as readonly T[];
  };
}

/** Every item satisfies the group's adapter contract. */
function assertContracts(group: IntegrationGroup, items: readonly unknown[]): void {
  for (const [index, item] of items.entries()) {
    const reasons = group.reasons(item);
    if (reasons.length > 0) {
      throw new TypeError(`${group.name}[${String(index)}]: ${reasons.join("; ")}`);
    }
  }
}

/** The identity of an item that passed its contract check. */
function identityOf(item: unknown): { kind: string; name: string } {
  return (item as { metadata: { kind: string; name: string } }).metadata;
}

/**
 * No two items share a provider kind: a kind names a provider in stored channels and credentials,
 * so a second one would answer for the first one's. The error names the later item, the kind and
 * the provider that already holds it.
 */
export function assertUniqueKinds(group: IntegrationGroup, items: readonly unknown[]): void {
  const owners = new Map<string, string>();
  for (const [index, item] of items.entries()) {
    const { kind, name } = identityOf(item);
    const owner = owners.get(kind);
    if (owner !== undefined) {
      throw new Error(
        `${group.name}[${String(index)}] ("${name}"): kind "${kind}" is already used by ` +
          `"${owner}"; a provider kind must be unique. To replace a built-in, return the list ` +
          `without it.`,
      );
    }
    owners.set(kind, name);
  }
}
