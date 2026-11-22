/**
 * The testing-only image libraries, `pngjs` and `pixelmatch`, are optional peers of core: a hosting-only
 * install (no `testing` option) never loads them, and `@storyshelf/runner` brings them for a testing
 * install (ADR 0049, amendment 2026-11-21). Load them only through here, on first use.
 */

/** The optional peers `./diff` needs for a comparison. */
export const DIFF_PEERS = ["pngjs", "pixelmatch"] as const;

/** The error for a missing peer: names it and the install line, and says the runner brings it. */
export function missingPeerError(name: string, cause: unknown): Error {
  return new Error(
    `Testing needs the optional \`${name}\` package, which is not installed. ` +
      `It comes with \`@storyshelf/runner\`; otherwise install it next to StoryShelf (\`nub add ${DIFF_PEERS.join(" ")}\`).`,
    { cause },
  );
}

/** Run a lazy import, turning a failure into {@link missingPeerError} for `name`. */
export async function importPeer<T>(name: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    throw missingPeerError(name, error);
  }
}
