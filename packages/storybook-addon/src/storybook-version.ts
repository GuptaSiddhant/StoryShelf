/** Which Storybook a project runs, from the `storybook` package its config directory resolves. */
import { createRequire } from "node:module";
import { join } from "node:path";

/** True for Storybook 8, whose manager API is externalized under another name than 9 and later. */
export function isLegacyStorybook(configDir: string | undefined): boolean {
  try {
    const require = createRequire(join(configDir ?? process.cwd(), "noop.js"));
    const { version } = require("storybook/package.json") as { version: string };
    return Number(version.split(".")[0]) < 9;
  } catch {
    return false;
  }
}
