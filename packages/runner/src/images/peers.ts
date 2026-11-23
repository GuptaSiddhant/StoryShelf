/**
 * `pngjs` and `pixelmatch` are dependencies of `@storyshelf/runner` (`sharp` is its optional peer,
 * loaded by `sharp.ts`): core never imports an image library (#1365). They load lazily, on first
 * use, only through here, so a missing one fails with a message that names it.
 */

/** The packages `./images` needs for a comparison. */
export const DIFF_PEERS = ["pngjs", "pixelmatch"] as const;

/** The error for a missing peer: names it and the install line, and says the runner brings it. */
export function missingPeerError(name: string, cause: unknown): Error {
  return new Error(
    `Testing needs the \`${name}\` package, which is not installed. ` +
      `It is a dependency of \`@storyshelf/runner\`: reinstall the runner, or add it next to StoryShelf (\`nub add ${DIFF_PEERS.join(" ")}\`).`,
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
