/** Parse `--label key=value` flags into label pairs. */
export function parseLabels(flags: string[] | undefined): { key: string; value: string }[] {
  return (flags ?? []).map((flag) => {
    const eq = flag.indexOf("=");
    if (eq <= 0) {
      throw new Error(`--label must be key=value, got "${flag}"`);
    }
    return { key: flag.slice(0, eq), value: flag.slice(eq + 1) };
  });
}
