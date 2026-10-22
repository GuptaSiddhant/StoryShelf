// The package's main entry (`src/index.ts[x]`) is a module TypeDoc names "index". Rename it so the
// page at the root of each package reference reads "Overview" (see `entryModule` in typedoc-packages.mjs).
import { Converter } from "typedoc";

export const MAIN_MODULE = "Overview";

export function load(app) {
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    for (const child of context.project.children ?? []) {
      if (child.name === "index") child.name = MAIN_MODULE;
    }
  });
}
