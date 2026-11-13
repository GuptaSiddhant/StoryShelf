/** Storybook preset: adds the manager entry that shows the badges. Add `@storyshelf/storybook-addon` to `addons`. */
import { fileURLToPath } from "node:url";
import { isLegacyStorybook } from "./storybook-version.ts";

/** Storybook 8.6 and 9+ read the same `managerEntries` hook; the file differs by the API name it imports. */
export function managerEntries(
  entries: readonly string[] = [],
  options: { configDir?: string } = {},
): string[] {
  const file = isLegacyStorybook(options.configDir) ? "./legacy/manager.mjs" : "./manager.mjs";
  return [...entries, fileURLToPath(new URL(file, import.meta.url))];
}
