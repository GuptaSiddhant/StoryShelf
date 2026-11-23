/**
 * Node module-resolution hook for `peer-isolation.test.ts`: makes the testing-only libraries
 * unresolvable (`SHELF_BLOCKED_PEERS`, a comma-separated list of package names), so a hosting-only
 * boot fails if anything on its path imports one of them.
 */
type NextResolve = (specifier: string, context: object) => Promise<unknown>;

const blocked = (process.env["SHELF_BLOCKED_PEERS"] ?? "").split(",").filter(Boolean);

export async function resolve(
  specifier: string,
  context: object,
  nextResolve: NextResolve,
): Promise<unknown> {
  if (blocked.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
    throw new Error(`blocked peer: ${specifier}`);
  }
  return await nextResolve(specifier, context);
}
