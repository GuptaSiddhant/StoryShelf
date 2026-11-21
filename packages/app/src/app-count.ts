/**
 * How many apps this process has constructed. Kept on `globalThis` under a registered symbol, so a
 * second copy of this package in `node_modules` counts into the same number: `storyshelf-server`
 * uses it to refuse an instance module that built an app of its own before the bin's.
 */
const KEY = Symbol.for("storyshelf.apps-constructed");

type Counter = { [KEY]?: number };

/** Record one more constructed app. */
export function noteAppConstructed(): void {
  const holder = globalThis as Counter;
  holder[KEY] = (holder[KEY] ?? 0) + 1;
}

/** The number of apps constructed in this process so far. */
export function appsConstructed(): number {
  return (globalThis as Counter)[KEY] ?? 0;
}
