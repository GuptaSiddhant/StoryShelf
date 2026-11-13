/**
 * The `SS_*` variables were renamed to `SHELF_*` with no aliases (#948). The server refuses to boot
 * while any `SS_*` name is set, so a silently ignored value can never turn off the AI budget or the
 * login text. The error names each old variable and its new name, never a value.
 */
const LEGACY_PREFIX = "SS_";

/** Throws one error naming every `SS_*` variable that is set, with its `SHELF_*` name and no value. */
export function refuseLegacyVariables(env: Readonly<Record<string, string | undefined>>): void {
  const legacy = Object.keys(env).filter((name) => name.startsWith(LEGACY_PREFIX));
  if (legacy.length === 0) {
    return;
  }
  const renames = legacy.map((name) => `  ${name} -> ${name.replace(/^SS_/u, "SHELF_")}`);
  throw new Error(
    `StoryShelf no longer reads the SS_* variables. Rename them, then start again:\n${renames.join("\n")}`,
  );
}
