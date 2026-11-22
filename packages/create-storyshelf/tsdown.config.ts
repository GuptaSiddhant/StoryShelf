import { cliConfig } from "../../config/tsdown.ts";

// One file with no runtime dependencies: `npm create storyshelf` downloads and runs it, so it
// bundles `prompts` (and its two dependencies) instead of installing them.
const base = cliConfig({ index: "./src/index.ts" });

export default {
  ...base,
  unbundle: false,
  deps: { ...base.deps, alwaysBundle: [/^prompts(\/|$)/u, /^kleur(\/|$)/u, /^sisteransi(\/|$)/u] },
};
